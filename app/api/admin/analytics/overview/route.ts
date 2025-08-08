// app/api/admin/analytics/overview/route.ts - ADMIN uniquement
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const querySchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  laundryId: z.string().min(1, 'laundryId is required')
})

export async function GET(request: NextRequest) {
  // Vérifier que l'utilisateur est ADMIN UNIQUEMENT
  const authResult = await requireRole(request, ['ADMIN'])
  
  if (authResult instanceof NextResponse) {
    return authResult // Erreur d'authentification ou d'autorisation
  }

  const { user } = authResult

  // Vérifier que user.sub existe
  if (!user.sub) {
    return NextResponse.json(
      { success: false, message: 'Invalid user session' },
      { status: 401 }
    )
  }

  try {
    const { searchParams } = new URL(request.url)
    const queryParams = Object.fromEntries(searchParams.entries())
    
    const parsed = querySchema.safeParse(queryParams)
    if (!parsed.success) {
      return NextResponse.json(
        { 
          success: false, 
          message: 'Invalid query parameters', 
          errors: parsed.error.errors 
        },
        { status: 400 }
      )
    }

    const { laundryId } = parsed.data
    
    // Dates par défaut: derniers 30 jours
    const endDate = parsed.data.endDate ? new Date(parsed.data.endDate) : new Date()
    const startDate = parsed.data.startDate ? new Date(parsed.data.startDate) : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000)

    // Vérifier que l'admin a accès à cette laundry
    const adminUser = await prisma.user.findUnique({
      where: { id: user.sub },
      include: { laundry: true }
    })

    if (!adminUser?.laundry || adminUser.laundry.id !== laundryId) {
      return NextResponse.json(
        { success: false, message: 'Access denied: Admin must be associated with the specified laundry' },
        { status: 403 }
      )
    }

    // Récupérer toutes les données nécessaires
    const [
      orders,
      allTimeOrders,
      customers,
      products,
      reviews,
      activities
    ] = await Promise.all([
      // Commandes dans la période
      prisma.order.findMany({
        where: {
          laundryId,
          createdAt: {
            gte: startDate,
            lte: endDate
          }
        },
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              email: true,
              createdAt: true
            }
          },
          orderItems: {
            include: {
              product: {
                select: {
                  category: true,
                  name: true,
                  unit: true
                }
              }
            }
          },
          address: {
            select: {
              city: true,
              state: true
            }
          }
        },
        orderBy: { createdAt: 'asc' }
      }),

      // Toutes les commandes pour comparaison
      prisma.order.findMany({
        where: { laundryId },
        select: {
          id: true,
          finalAmount: true,
          status: true,
          createdAt: true,
          customerId: true
        }
      }),

      // Customers qui ont commandé dans cette laundry
      prisma.user.findMany({
        where: {
          role: 'CUSTOMER',
          orders: {
            some: { laundryId }
          }
        },
        include: {
          orders: {
            where: { laundryId },
            select: {
              finalAmount: true,
              status: true,
              createdAt: true
            }
          }
        }
      }),

      // Produits
      prisma.product.findMany({
        where: { laundryId },
        include: {
          orderItems: {
            where: {
              order: {
                createdAt: {
                  gte: startDate,
                  lte: endDate
                }
              }
            }
          }
        }
      }),

      // Reviews dans la période
      prisma.review.findMany({
        where: {
          laundryId,
          createdAt: {
            gte: startDate,
            lte: endDate
          }
        },
        select: {
          rating: true,
          comment: true,
          createdAt: true
        }
      }),

      // Activités récentes
      prisma.activity.findMany({
        where: {
          laundryId,
          createdAt: {
            gte: startDate,
            lte: endDate
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 50
      })
    ])

    // 1. MÉTRIQUES PRINCIPALES
    const completedOrders = orders.filter(order => ['DELIVERED', 'COMPLETED'].includes(order.status))
    const totalRevenue = completedOrders.reduce((sum, order) => sum + order.finalAmount, 0)
    const totalOrders = orders.length
    const averageOrderValue = completedOrders.length > 0 ? totalRevenue / completedOrders.length : 0

    // Clients uniques dans la période
    const uniqueCustomers = new Set(orders.map(order => order.customer.id)).size

    // 2. ANALYSE TEMPORELLE (Performance journalière)
    const dailyPerformance: any[] = []
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
    
    for (let i = 0; i <= daysDiff; i++) {
      const currentDate = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000)
      const dayStart = new Date(currentDate.setHours(0, 0, 0, 0))
      const dayEnd = new Date(currentDate.setHours(23, 59, 59, 999))
      
      const dayOrders = orders.filter(order => 
        order.createdAt >= dayStart && order.createdAt <= dayEnd
      )
      
      const dayCompletedOrders = dayOrders.filter(order => ['DELIVERED', 'COMPLETED'].includes(order.status))
      const dayRevenue = dayCompletedOrders.reduce((sum, order) => sum + order.finalAmount, 0)
      const dayCustomers = new Set(dayOrders.map(order => order.customer.id)).size
      
      dailyPerformance.push({
        date: dayStart.toISOString().split('T')[0],
        orders: dayOrders.length,
        completedOrders: dayCompletedOrders.length,
        revenue: Math.round(dayRevenue * 100) / 100,
        customers: dayCustomers,
        averageOrderValue: dayCompletedOrders.length > 0 ? Math.round((dayRevenue / dayCompletedOrders.length) * 100) / 100 : 0
      })
    }

    // 3. ANALYSE PAR STATUT DE COMMANDE
    const orderStatusBreakdown = orders.reduce((acc: Record<string, number>, order) => {
      acc[order.status] = (acc[order.status] || 0) + 1
      return acc
    }, {})

    // 4. ANALYSE DES CLIENTS
    const customerAnalysis = customers.map(customer => {
      const customerOrders = customer.orders.filter(order => ['DELIVERED', 'COMPLETED'].includes(order.status))
      const totalSpent = customerOrders.reduce((sum, order) => sum + order.finalAmount, 0)
      const orderCount = customerOrders.length
      
      // Déterminer le segment
      let segment: string
      if (orderCount === 0) segment = 'Prospect'
      else if (orderCount === 1) segment = 'New'
      else if (orderCount <= 3 && totalSpent < 200) segment = 'Regular'
      else if (orderCount <= 10 && totalSpent < 1000) segment = 'Loyal'
      else segment = 'VIP'

      return {
        id: customer.id,
        segment,
        totalSpent,
        orderCount,
        averageOrderValue: orderCount > 0 ? totalSpent / orderCount : 0,
        lastOrderDate: customerOrders.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]?.createdAt || null
      }
    })

    const customerSegments = customerAnalysis.reduce((acc: Record<string, number>, customer) => {
      acc[customer.segment] = (acc[customer.segment] || 0) + 1
      return acc
    }, {})

    // 5. ANALYSE DES PRODUITS/SERVICES
    const productPerformance = products.map(product => {
      const revenue = product.orderItems.reduce((sum, item) => sum + item.totalPrice, 0)
      const quantity = product.orderItems.reduce((sum, item) => sum + item.quantity, 0)
      const orders = product.orderItems.length

      return {
        id: product.id,
        name: product.name,
        category: product.category,
        revenue: Math.round(revenue * 100) / 100,
        quantity,
        orders,
        revenueShare: totalRevenue > 0 ? Math.round((revenue / totalRevenue) * 100) : 0
      }
    }).sort((a, b) => b.revenue - a.revenue)

    // 6. ANALYSE GÉOGRAPHIQUE (par ville)
    const locationAnalysis = orders.reduce((acc: Record<string, {orders: number, revenue: number, customers: Set<string>}>, order) => {
      const location = `${order.address.city}, ${order.address.state}`
      
      if (!acc[location]) {
        acc[location] = { orders: 0, revenue: 0, customers: new Set() }
      }
      
      acc[location].orders += 1
      if (['DELIVERED', 'COMPLETED'].includes(order.status)) {
        acc[location].revenue += order.finalAmount
      }
      acc[location].customers.add(order.customer.id)
      
      return acc
    }, {})

    const topLocations = Object.entries(locationAnalysis)
      .map(([location, data]) => ({
        location,
        orders: data.orders,
        revenue: Math.round(data.revenue * 100) / 100,
        customers: data.customers.size,
        averageOrderValue: data.orders > 0 ? Math.round((data.revenue / data.orders) * 100) / 100 : 0
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)

    // 7. ANALYSE DES REVIEWS
    const averageRating = reviews.length > 0 
      ? Math.round((reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length) * 100) / 100
      : 0

    const ratingDistribution = reviews.reduce((acc: Record<number, number>, review) => {
      acc[review.rating] = (acc[review.rating] || 0) + 1
      return acc
    }, {})

    // 8. TENDANCES ET COMPARAISONS
    const previousPeriodStart = new Date(startDate.getTime() - (endDate.getTime() - startDate.getTime()))
    const previousPeriodOrders = allTimeOrders.filter(order => 
      order.createdAt >= previousPeriodStart && order.createdAt < startDate
    )
    const previousRevenue = previousPeriodOrders
      .filter(order => ['DELIVERED', 'COMPLETED'].includes(order.status))
      .reduce((sum, order) => sum + order.finalAmount, 0)

    const revenueGrowth = previousRevenue > 0 ? ((totalRevenue - previousRevenue) / previousRevenue) * 100 : 0
    const orderGrowth = previousPeriodOrders.length > 0 ? ((totalOrders - previousPeriodOrders.length) / previousPeriodOrders.length) * 100 : 0

    // 9. INSIGHTS ET RECOMMANDATIONS
    const insights = generateAnalyticsInsights({
      totalRevenue,
      totalOrders,
      uniqueCustomers,
      averageOrderValue,
      revenueGrowth,
      orderGrowth,
      customerSegments,
      productPerformance,
      averageRating,
      orderStatusBreakdown
    })

    const response = {
      laundryId,
      laundryName: adminUser.laundry.name,
      period: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        days: daysDiff + 1
      },
      
      // Métriques principales
      overview: {
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalOrders,
        completedOrders: completedOrders.length,
        uniqueCustomers,
        averageOrderValue: Math.round(averageOrderValue * 100) / 100,
        averageRating,
        totalReviews: reviews.length,
        
        // Croissance
        growth: {
          revenue: Math.round(revenueGrowth * 100) / 100,
          orders: Math.round(orderGrowth * 100) / 100
        }
      },
      
      // Données pour graphiques
      charts: {
        dailyPerformance,
        orderStatusBreakdown: Object.entries(orderStatusBreakdown).map(([status, count]) => ({
          status,
          count,
          percentage: Math.round((count / totalOrders) * 100)
        })),
        customerSegments: Object.entries(customerSegments).map(([segment, count]) => ({
          segment,
          count,
          percentage: Math.round((count / customers.length) * 100)
        })),
        ratingDistribution: Object.entries(ratingDistribution).map(([rating, count]) => ({
          rating: parseInt(rating),
          count,
          percentage: Math.round((count / reviews.length) * 100)
        }))
      },
      
      // Analyses détaillées
      analysis: {
        topProducts: productPerformance.slice(0, 10),
        topLocations,
        customerLifetimeValue: customers.length > 0 
          ? Math.round((allTimeOrders.filter(o => ['DELIVERED', 'COMPLETED'].includes(o.status)).reduce((sum, o) => sum + o.finalAmount, 0) / customers.length) * 100) / 100
          : 0,
        repeatCustomerRate: customers.length > 0 
          ? Math.round((customers.filter(c => c.orders.length > 1).length / customers.length) * 100)
          : 0
      },
      
      // Insights et recommandations
      insights,
      
      // Activités récentes
      recentActivities: activities.slice(0, 10).map(activity => ({
        type: activity.type,
        title: activity.title,
        description: activity.description,
        createdAt: activity.createdAt
      }))
    }

    return NextResponse.json({
      success: true,
      message: 'Analytics overview data retrieved successfully',
      data: response,
      requestedBy: {
        userId: user.sub,
        role: user.role,
        laundryId
      }
    })

  } catch (error) {
    console.error('Analytics overview error:', error)
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Helper function pour générer des insights
function generateAnalyticsInsights(data: {
  totalRevenue: number
  totalOrders: number
  uniqueCustomers: number
  averageOrderValue: number
  revenueGrowth: number
  orderGrowth: number
  customerSegments: Record<string, number>
  productPerformance: any[]
  averageRating: number
  orderStatusBreakdown: Record<string, number>
}): string[] {
  const insights: string[] = []
  
  // Revenue insights
  if (data.revenueGrowth > 20) {
    insights.push(`Excellent revenue growth of ${data.revenueGrowth.toFixed(1)}% compared to previous period`)
  } else if (data.revenueGrowth < -10) {
    insights.push(`Revenue declined by ${Math.abs(data.revenueGrowth).toFixed(1)}% - investigate causes and implement recovery strategies`)
  }
  
  // Order insights
  if (data.orderGrowth > 15) {
    insights.push(`Strong order growth of ${data.orderGrowth.toFixed(1)}% - scaling operations may be needed`)
  }
  
  // Customer insights
  const vipCustomers = data.customerSegments.VIP || 0
  const totalCustomers = Object.values(data.customerSegments).reduce((a, b) => a + b, 0)
  if (vipCustomers > 0 && totalCustomers > 0) {
    const vipPercentage = (vipCustomers / totalCustomers) * 100
    if (vipPercentage > 15) {
      insights.push(`Strong VIP customer base (${vipPercentage.toFixed(0)}%) - consider premium services`)
    }
  }
  
  // Product insights
  if (data.productPerformance.length > 0) {
    const topProduct = data.productPerformance[0]
    if (topProduct.revenueShare > 40) {
      insights.push(`High dependency on "${topProduct.name}" (${topProduct.revenueShare}% of revenue) - diversify offerings`)
    }
  }
  
  // Rating insights
  if (data.averageRating > 4.5) {
    insights.push(`Excellent customer satisfaction with ${data.averageRating}/5 average rating`)
  } else if (data.averageRating < 3.5) {
    insights.push(`Customer satisfaction needs attention (${data.averageRating}/5) - focus on service quality`)
  }
  
  // Order status insights
  const pendingOrders = data.orderStatusBreakdown.PENDING || 0
  if (pendingOrders > data.totalOrders * 0.2) {
    insights.push(`High number of pending orders (${pendingOrders}) - review processing efficiency`)
  }
  
  return insights
}
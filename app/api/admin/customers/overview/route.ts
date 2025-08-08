// app/api/admin/customers/overview/route.ts - ADMIN uniquement
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const querySchema = z.object({
  timeframe: z.enum(['week', 'month', 'quarter', 'year']).optional().default('month'),
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

    const { timeframe, laundryId } = parsed.data

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

    // Calculer les dates selon le timeframe
    const now = new Date()
    let startDate: Date
    let previousStartDate: Date

    switch (timeframe) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        previousStartDate = new Date(startDate.getTime() - 7 * 24 * 60 * 60 * 1000)
        break
      case 'month':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        previousStartDate = new Date(startDate.getTime() - 30 * 24 * 60 * 60 * 1000)
        break
      case 'quarter':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
        previousStartDate = new Date(startDate.getTime() - 90 * 24 * 60 * 60 * 1000)
        break
      case 'year':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
        previousStartDate = new Date(startDate.getTime() - 365 * 24 * 60 * 60 * 1000)
        break
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        previousStartDate = new Date(startDate.getTime() - 30 * 24 * 60 * 60 * 1000)
    }

    // Récupérer tous les customers qui ont commandé dans cette laundry
    const [
      allCustomers,
      currentPeriodCustomers,
      previousPeriodCustomers,
      allOrders,
      currentPeriodOrders
    ] = await Promise.all([
      // Tous les customers de cette laundry
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
              id: true,
              finalAmount: true,
              status: true,
              createdAt: true
            }
          },
          _count: {
            select: {
              orders: {
                where: { laundryId }
              }
            }
          }
        }
      }),

      // Nouveaux customers dans la période actuelle
      prisma.user.findMany({
        where: {
          role: 'CUSTOMER',
          orders: {
            some: {
              laundryId,
              createdAt: { gte: startDate }
            }
          },
          createdAt: { gte: startDate }
        }
      }),

      // Nouveaux customers dans la période précédente
      prisma.user.findMany({
        where: {
          role: 'CUSTOMER',
          orders: {
            some: {
              laundryId,
              createdAt: {
                gte: previousStartDate,
                lt: startDate
              }
            }
          },
          createdAt: {
            gte: previousStartDate,
            lt: startDate
          }
        }
      }),

      // Toutes les commandes de cette laundry
      prisma.order.findMany({
        where: { laundryId },
        select: {
          id: true,
          customerId: true,
          finalAmount: true,
          status: true,
          createdAt: true
        }
      }),

      // Commandes de la période actuelle
      prisma.order.findMany({
        where: {
          laundryId,
          createdAt: { gte: startDate }
        },
        select: {
          id: true,
          customerId: true,
          finalAmount: true,
          status: true,
          createdAt: true
        }
      })
    ])

    // Calculer les métriques principales
    const totalCustomers = allCustomers.length
    const newCustomersThisPeriod = currentPeriodCustomers.length
    const newCustomersPreviousPeriod = previousPeriodCustomers.length
    const customerGrowth = newCustomersPreviousPeriod > 0 
      ? ((newCustomersThisPeriod - newCustomersPreviousPeriod) / newCustomersPreviousPeriod) * 100 
      : newCustomersThisPeriod > 0 ? 100 : 0

    // Customers actifs (qui ont commandé dans la période)
    const activeCustomerIds = new Set(currentPeriodOrders.map(order => order.customerId))
    const activeCustomers = activeCustomerIds.size

    // Calculer Customer Lifetime Value (LTV)
    const totalRevenue = allOrders.reduce((sum, order) => 
      ['DELIVERED', 'COMPLETED'].includes(order.status) ? sum + order.finalAmount : sum, 0
    )
    const averageLTV = totalCustomers > 0 ? totalRevenue / totalCustomers : 0

    // Segmentation des customers
    const customerSegments = allCustomers.reduce((segments: Record<string, number>, customer) => {
      const completedOrders = customer.orders.filter(order => 
        ['DELIVERED', 'COMPLETED'].includes(order.status)
      )
      const orderCount = completedOrders.length
      const totalSpent = completedOrders.reduce((sum, order) => sum + order.finalAmount, 0)
      
      let segment: string
      if (orderCount === 0) segment = 'Prospects'
      else if (orderCount === 1) segment = 'New'
      else if (orderCount <= 3 && totalSpent < 200) segment = 'Regular'
      else if (orderCount <= 10 && totalSpent < 1000) segment = 'Loyal'
      else segment = 'VIP'
      
      segments[segment] = (segments[segment] || 0) + 1
      return segments
    }, {})

    // Données de croissance mensuelle (pour le graphique)
    const monthlyTrends: any[] = []
    const monthsToShow = timeframe === 'year' ? 12 : timeframe === 'quarter' ? 3 : 6
    
    for (let i = monthsToShow - 1; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0)
      
      const newCustomersInMonth = await prisma.user.count({
        where: {
          role: 'CUSTOMER',
          createdAt: {
            gte: monthStart,
            lte: monthEnd
          },
          orders: {
            some: { laundryId }
          }
        }
      })

      const activeCustomersInMonth = await prisma.order.findMany({
        where: {
          laundryId,
          createdAt: {
            gte: monthStart,
            lte: monthEnd
          }
        },
        select: { customerId: true },
        distinct: ['customerId']
      })

      monthlyTrends.push({
        month: monthStart.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        newCustomers: newCustomersInMonth,
        activeCustomers: activeCustomersInMonth.length,
        date: monthStart.toISOString()
      })
    }

    // Top customers par valeur
    const topCustomers = allCustomers
      .map(customer => {
        const completedOrders = customer.orders.filter(order => 
          ['DELIVERED', 'COMPLETED'].includes(order.status)
        )
        const lastOrder = completedOrders.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
        
        return {
          id: customer.id,
          name: customer.name || customer.email.split('@')[0],
          email: customer.email,
          totalOrders: completedOrders.length,
          totalSpent: completedOrders.reduce((sum, order) => sum + order.finalAmount, 0),
          averageOrderValue: completedOrders.length > 0 
            ? completedOrders.reduce((sum, order) => sum + order.finalAmount, 0) / completedOrders.length 
            : 0,
          lastOrderDate: lastOrder?.createdAt || null,
          daysSinceLastOrder: lastOrder 
            ? Math.floor((now.getTime() - lastOrder.createdAt.getTime()) / (1000 * 60 * 60 * 24))
            : null,
          memberSince: customer.createdAt
        }
      })
      .filter(customer => customer.totalSpent > 0)
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, 10)

    // Retention analysis
    const retentionAnalysis = await calculateRetentionRate(laundryId, startDate, previousStartDate)

    const response = {
      laundryId,
      timeframe,
      period: {
        startDate: startDate.toISOString(),
        endDate: now.toISOString(),
        previousStartDate: previousStartDate.toISOString()
      },
      
      // Métriques principales
      metrics: {
        totalCustomers,
        activeCustomers,
        newCustomersThisPeriod,
        averageLTV: Math.round(averageLTV * 100) / 100,
        customerGrowthRate: Math.round(customerGrowth * 100) / 100,
        retentionRate: retentionAnalysis.retentionRate,
        churnRate: retentionAnalysis.churnRate
      },
      
      // Données de croissance pour graphiques
      growthData: monthlyTrends,
      
      // Segmentation
      segments: Object.entries(customerSegments).map(([segment, count]) => ({
        segment,
        count,
        percentage: Math.round((count / totalCustomers) * 100)
      })),
      
      // Top customers
      topCustomers,
      
      // Insights et recommandations
      insights: generateCustomerInsights({
        totalCustomers,
        activeCustomers,
        customerGrowth,
        retentionRate: retentionAnalysis.retentionRate,
        segments: customerSegments
      })
    }

    return NextResponse.json({
      success: true,
      message: 'Customer overview data retrieved successfully',
      data: response,
      requestedBy: {
        userId: user.sub,
        role: user.role,
        laundryId
      }
    })

  } catch (error) {
    console.error('Customer overview error:', error)
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Helper function pour calculer le taux de rétention
async function calculateRetentionRate(laundryId: string, currentStart: Date, previousStart: Date) {
  // Customers qui ont commandé dans les deux périodes
  const [currentCustomers, previousCustomers] = await Promise.all([
    prisma.order.findMany({
      where: {
        laundryId,
        createdAt: { gte: currentStart }
      },
      select: { customerId: true },
      distinct: ['customerId']
    }),
    
    prisma.order.findMany({
      where: {
        laundryId,
        createdAt: {
          gte: previousStart,
          lt: currentStart
        }
      },
      select: { customerId: true },
      distinct: ['customerId']
    })
  ])

  const currentCustomerIds = new Set(currentCustomers.map(o => o.customerId))
  const previousCustomerIds = new Set(previousCustomers.map(o => o.customerId))
  
  const retainedCustomers = previousCustomers.filter(customer => 
    currentCustomerIds.has(customer.customerId)
  ).length

  const retentionRate = previousCustomers.length > 0 
    ? (retainedCustomers / previousCustomers.length) * 100 
    : 0
    
  const churnRate = 100 - retentionRate

  return {
    retentionRate: Math.round(retentionRate * 100) / 100,
    churnRate: Math.round(churnRate * 100) / 100,
    retainedCustomers,
    previousPeriodCustomers: previousCustomers.length,
    newCustomers: currentCustomers.length - retainedCustomers
  }
}

// Helper function pour générer des insights
function generateCustomerInsights(data: {
  totalCustomers: number
  activeCustomers: number
  customerGrowth: number
  retentionRate: number
  segments: Record<string, number>
}): string[] {
  const insights: string[] = []
  
  // Growth insights
  if (data.customerGrowth > 20) {
    insights.push(`Excellent customer growth of ${data.customerGrowth.toFixed(1)}% this period`)
  } else if (data.customerGrowth < 0) {
    insights.push(`Customer acquisition declined by ${Math.abs(data.customerGrowth).toFixed(1)}% - consider marketing campaigns`)
  }
  
  // Activity insights
  const activityRate = (data.activeCustomers / data.totalCustomers) * 100
  if (activityRate < 30) {
    insights.push(`Only ${activityRate.toFixed(0)}% of customers are active - consider re-engagement campaigns`)
  } else if (activityRate > 60) {
    insights.push(`High customer activity rate of ${activityRate.toFixed(0)}% - great engagement!`)
  }
  
  // Retention insights
  if (data.retentionRate > 70) {
    insights.push(`Strong customer retention at ${data.retentionRate.toFixed(0)}%`)
  } else if (data.retentionRate < 40) {
    insights.push(`Low retention rate of ${data.retentionRate.toFixed(0)}% - focus on customer satisfaction`)
  }
  
  // Segment insights
  const vipCount = data.segments.VIP || 0
  const vipPercentage = (vipCount / data.totalCustomers) * 100
  if (vipPercentage > 10) {
    insights.push(`${vipPercentage.toFixed(0)}% VIP customers - strong loyalty base`)
  }
  
  return insights
}
// app/api/super-admin/laundries/[laundryId]/route.ts - SUPER_ADMIN uniquement
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

// Schema pour la mise à jour d'une laundry - Adapté au schéma actuel
const updateLaundrySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  email: z.string().email().optional(),
  phone: z.string().regex(/^\+?[1-9]\d{1,14}$/).optional(),
  logo: z.string().url().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING']).optional(),
  
  // Heures d'ouverture (format JSON existant)
  operatingHours: z.record(z.object({
    open: z.string(),
    close: z.string(),
    closed: z.boolean()
  })).optional(),
  
  // Adresse principale
  address: z.object({
    street: z.string().min(1),
    city: z.string().min(1),
    state: z.string().min(1),
    zipCode: z.string().min(1),
    country: z.string().optional().default('Morocco'),
    latitude: z.number().optional(),
    longitude: z.number().optional()
  }).optional()
})

// PATCH /api/super-admin/laundries/[laundryId] - SUPER_ADMIN uniquement
export async function PATCH(
  request: NextRequest,
  { params }: { params: { laundryId: string } }
) {
  // Vérifier que l'utilisateur est SUPER_ADMIN UNIQUEMENT
  const authResult = await requireRole(request, ['SUPER_ADMIN'])
  
  if (authResult instanceof NextResponse) {
    return authResult
  }

  const { user } = authResult

  if (!user.sub) {
    return NextResponse.json(
      { success: false, message: 'Invalid user session' },
      { status: 401 }
    )
  }

  try {
    const { laundryId } = params
    const body = await request.json()
    
    const parsed = updateLaundrySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { 
          success: false, 
          message: 'Validation error', 
          errors: parsed.error.errors 
        },
        { status: 400 }
      )
    }

    const updateData = parsed.data

    // Vérifier que la laundry existe
    const existingLaundry = await prisma.laundry.findUnique({
      where: { id: laundryId },
      include: {
        admin: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    })

    if (!existingLaundry) {
      return NextResponse.json(
        { success: false, message: 'Laundry not found' },
        { status: 404 }
      )
    }

    // Vérifier l'unicité de l'email si fourni
    if (updateData.email && updateData.email !== existingLaundry.email) {
      const emailExists = await prisma.laundry.findFirst({
        where: {
          email: updateData.email,
          id: { not: laundryId }
        }
      })

      if (emailExists) {
        return NextResponse.json(
          { success: false, message: 'Email address already in use by another laundry' },
          { status: 409 }
        )
      }
    }

    // Effectuer les modifications dans une transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Mettre à jour les informations de la laundry
      const updatedLaundry = await tx.laundry.update({
        where: { id: laundryId },
        data: {
          name: updateData.name,
          description: updateData.description,
          email: updateData.email,
          phone: updateData.phone,
          logo: updateData.logo,
          status: updateData.status,
          operatingHours: updateData.operatingHours,
          updatedAt: new Date()
        },
        include: {
          admin: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true
            }
          },
          addresses: true,
          _count: {
            select: {
              orders: true,
              products: true,
              reviews: true
            }
          }
        }
      })

      // 2. Gérer l'adresse principale si fournie
      if (updateData.address) {
        // Désactiver l'ancienne adresse par défaut pour cette laundry
        await tx.address.updateMany({
          where: {
            laundryId,
            isDefault: true
          },
          data: { isDefault: false }
        }).catch(() => {
          // Ignore si aucune adresse par défaut n'existe
        })

        // Créer une nouvelle adresse principale
        await tx.address.create({
          data: {
            ...updateData.address,
            laundryId,
            userId: existingLaundry.adminId, // Utiliser l'admin comme userId
            isDefault: true
          }
        })
      }

      // 3. Enregistrer l'activité de modification
      await tx.activity.create({
        data: {
          type: 'LAUNDRY_UPDATED',
          title: 'Laundry Updated by Super Admin',
          description: `Laundry "${existingLaundry.name}" was updated by super admin`,
          laundryId,
          metadata: {
            updatedBy: user.sub,
            updatedByRole: user.role,
            changes: Object.keys(updateData),
            previousStatus: existingLaundry.status,
            newStatus: updateData.status,
            timestamp: new Date().toISOString()
          }
        }
      })

      return updatedLaundry
    })

    // Formater la réponse
    const response = {
      laundry: {
        id: result.id,
        name: result.name,
        description: result.description,
        email: result.email,
        phone: result.phone,
        logo: result.logo,
        status: result.status,
        operatingHours: result.operatingHours,
        memberSince: result.createdAt,
        lastUpdated: result.updatedAt,
        
        admin: result.admin,
        addresses: result.addresses,
        
        stats: {
          totalOrders: result._count.orders,
          totalProducts: result._count.products,
          totalReviews: result._count.reviews
        }
      },
      
      changes: {
        fieldsUpdated: Object.keys(updateData),
        updatedAt: new Date().toISOString(),
        statusChanged: updateData.status && updateData.status !== existingLaundry.status,
        previousStatus: existingLaundry.status,
        newStatus: result.status
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Laundry updated successfully',
      data: response,
      updatedBy: {
        userId: user.sub,
        role: user.role
      }
    })

  } catch (error: any) {
    console.error('Update laundry error:', error)
    
    if (error?.code === 'P2002') {
      return NextResponse.json(
        { success: false, message: 'Email address already in use' },
        { status: 409 }
      )
    }
    
    return NextResponse.json(
      { success: false, message: 'Failed to update laundry' },
      { status: 500 }
    )
  }
}

// GET /api/super-admin/laundries/[laundryId]
export async function GET(
  request: NextRequest,
  { params }: { params: { laundryId: string } }
) {
  const authResult = await requireRole(request, ['SUPER_ADMIN'])
  
  if (authResult instanceof NextResponse) {
    return authResult
  }

  const { user } = authResult

  if (!user.sub) {
    return NextResponse.json(
      { success: false, message: 'Invalid user session' },
      { status: 401 }
    )
  }

  try {
    const { laundryId } = params

    // Récupérer les détails complets de la laundry
    const laundry = await prisma.laundry.findUnique({
      where: { id: laundryId },
      include: {
        admin: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            avatar: true,
            createdAt: true
          }
        },
        addresses: {
          select: {
            id: true,
            street: true,
            city: true,
            state: true,
            zipCode: true,
            country: true,
            latitude: true,
            longitude: true,
            isDefault: true
          },
          orderBy: { isDefault: 'desc' }
        },
        products: {
          select: {
            id: true,
            name: true,
            description: true,
            price: true,
            category: true,
            unit: true,
            isActive: true,
            createdAt: true,
            _count: {
              select: {
                orderItems: true
              }
            }
          },
          orderBy: { createdAt: 'desc' }
        },
        _count: {
          select: {
            orders: true,
            products: true,
            reviews: true
          }
        }
      }
    })

    if (!laundry) {
      return NextResponse.json(
        { success: false, message: 'Laundry not found' },
        { status: 404 }
      )
    }

    // Calculer les métriques de performance
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)

    const [
      monthlyOrders,
      quarterlyOrders,
      allOrders,
      monthlyRevenue,
      quarterlyRevenue,
      allTimeRevenue,
      customerStats,
      recentReviews,
      recentActivities
    ] = await Promise.all([
      // Commandes du mois
      prisma.order.findMany({
        where: {
          laundryId,
          createdAt: { gte: thirtyDaysAgo }
        },
        select: {
          id: true,
          finalAmount: true,
          status: true,
          createdAt: true,
          customerId: true
        }
      }),

      // Commandes des 3 derniers mois
      prisma.order.findMany({
        where: {
          laundryId,
          createdAt: { gte: ninetyDaysAgo }
        },
        select: {
          id: true,
          finalAmount: true,
          status: true,
          createdAt: true,
          customerId: true
        }
      }),

      // Toutes les commandes
      prisma.order.findMany({
        where: { laundryId },
        select: {
          id: true,
          finalAmount: true,
          status: true,
          createdAt: true,
          customerId: true
        },
        orderBy: { createdAt: 'desc' }
      }),

      // Revenus du mois
      prisma.order.aggregate({
        where: {
          laundryId,
          status: { in: ['DELIVERED', 'COMPLETED'] },
          createdAt: { gte: thirtyDaysAgo }
        },
        _sum: { finalAmount: true }
      }),

      // Revenus du trimestre
      prisma.order.aggregate({
        where: {
          laundryId,
          status: { in: ['DELIVERED', 'COMPLETED'] },
          createdAt: { gte: ninetyDaysAgo }
        },
        _sum: { finalAmount: true }
      }),

      // Revenus totaux
      prisma.order.aggregate({
        where: {
          laundryId,
          status: { in: ['DELIVERED', 'COMPLETED'] }
        },
        _sum: { finalAmount: true }
      }),

      // Statistiques clients
      prisma.order.findMany({
        where: { laundryId },
        select: { customerId: true },
        distinct: ['customerId']
      }),

      // Reviews récentes
      prisma.review.findMany({
        where: { laundryId },
        include: {
          customer: {
            select: {
              name: true,
              email: true,
              avatar: true
            }
          },
          order: {
            select: {
              orderNumber: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 10
      }),

      // Activités récentes
      prisma.activity.findMany({
        where: { laundryId },
        orderBy: { createdAt: 'desc' },
        take: 20
      })
    ])

    // Calculer les métriques de performance
    const monthlyCompletedOrders = monthlyOrders.filter((order: any) => 
      ['DELIVERED', 'COMPLETED'].includes(order.status)
    )
    const quarterlyCompletedOrders = quarterlyOrders.filter((order: any) => 
      ['DELIVERED', 'COMPLETED'].includes(order.status)
    )
    const allCompletedOrders = allOrders.filter((order: any) => 
      ['DELIVERED', 'COMPLETED'].includes(order.status)
    )

    // Clients uniques
    const monthlyUniqueCustomers = new Set(monthlyOrders.map((order: any) => order.customerId)).size
    const quarterlyUniqueCustomers = new Set(quarterlyOrders.map((order: any) => order.customerId)).size
    const totalUniqueCustomers = customerStats.length

    // Calculs des moyennes
    const monthlyAOV = monthlyCompletedOrders.length > 0 
      ? (monthlyRevenue._sum.finalAmount || 0) / monthlyCompletedOrders.length 
      : 0
    const allTimeAOV = allCompletedOrders.length > 0 
      ? (allTimeRevenue._sum.finalAmount || 0) / allCompletedOrders.length 
      : 0

    // Analyse de la croissance
    const previousMonthStart = new Date(thirtyDaysAgo.getTime() - 30 * 24 * 60 * 60 * 1000)
    const previousMonthOrders = allOrders.filter((order: any) => 
      order.createdAt >= previousMonthStart && order.createdAt < thirtyDaysAgo
    )
    const previousMonthRevenue = previousMonthOrders
      .filter((order: any) => ['DELIVERED', 'COMPLETED'].includes(order.status))
      .reduce((sum: number, order: any) => sum + order.finalAmount, 0)

    const orderGrowth = previousMonthOrders.length > 0 
      ? ((monthlyOrders.length - previousMonthOrders.length) / previousMonthOrders.length) * 100 
      : monthlyOrders.length > 0 ? 100 : 0

    const revenueGrowth = previousMonthRevenue > 0 
      ? (((monthlyRevenue._sum.finalAmount || 0) - previousMonthRevenue) / previousMonthRevenue) * 100 
      : (monthlyRevenue._sum.finalAmount || 0) > 0 ? 100 : 0

    // Distribution des statuts de commandes
    const orderStatusDistribution = monthlyOrders.reduce((acc: Record<string, number>, order: any) => {
      acc[order.status] = (acc[order.status] || 0) + 1
      return acc
    }, {})

    // Performance par semaine
    const weeklyPerformance: any[] = []
    for (let i = 3; i >= 0; i--) {
      const weekStart = new Date(now.getTime() - (i + 1) * 7 * 24 * 60 * 60 * 1000)
      const weekEnd = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000)
      
      const weekOrders = monthlyOrders.filter((order: any) => 
        order.createdAt >= weekStart && order.createdAt < weekEnd
      )
      const weekCompletedOrders = weekOrders.filter((order: any) => 
        ['DELIVERED', 'COMPLETED'].includes(order.status)
      )
      const weekRevenue = weekCompletedOrders.reduce((sum: number, order: any) => sum + order.finalAmount, 0)
      
      weeklyPerformance.push({
        week: `Week ${4 - i}`,
        startDate: weekStart.toISOString().split('T')[0],
        endDate: weekEnd.toISOString().split('T')[0],
        orders: weekOrders.length,
        completedOrders: weekCompletedOrders.length,
        revenue: Math.round(weekRevenue * 100) / 100,
        customers: new Set(weekOrders.map((order: any) => order.customerId)).size
      })
    }

    // Top produits par popularité
    const productPerformance = await prisma.orderItem.groupBy({
      by: ['productId'],
      where: {
        product: { laundryId },
        order: {
          status: { in: ['DELIVERED', 'COMPLETED'] },
          createdAt: { gte: thirtyDaysAgo }
        }
      },
      _count: { productId: true },
      _sum: { totalPrice: true, quantity: true },
      orderBy: {
        _count: { productId: 'desc' }
      },
      take: 5
    })

    const topProductsWithNames = await Promise.all(
      productPerformance.map(async (item) => {
        const product = await prisma.product.findUnique({
          where: { id: item.productId },
          select: { name: true, category: true, price: true }
        })
        return {
          productId: item.productId,
          name: product?.name || 'Unknown Product',
          category: product?.category || 'Other',
          currentPrice: product?.price || 0,
          orders: item._count.productId,
          revenue: item._sum.totalPrice || 0,
          quantity: item._sum.quantity || 0
        }
      })
    )

    // Analyse des reviews
    const averageRating = laundry.totalReviews > 0 && laundry.rating 
      ? Math.round(laundry.rating * 100) / 100 
      : 0

    const ratingDistribution = recentReviews.reduce((acc: Record<number, number>, review) => {
      acc[review.rating] = (acc[review.rating] || 0) + 1
      return acc
    }, {})

    // Formatage de la réponse finale
    const response = {
      // Informations de base
      id: laundry.id,
      name: laundry.name,
      description: laundry.description,
      email: laundry.email,
      phone: laundry.phone,
      logo: laundry.logo,
      status: laundry.status,
      operatingHours: laundry.operatingHours,
      memberSince: laundry.createdAt,
      lastUpdated: laundry.updatedAt,

      // Propriétaire/Admin
      admin: laundry.admin,

      // Adresses
      addresses: laundry.addresses,
      primaryAddress: laundry.addresses.find(addr => addr.isDefault) || laundry.addresses[0] || null,

      // Métriques de performance
      performance: {
        monthly: {
          orders: monthlyOrders.length,
          completedOrders: monthlyCompletedOrders.length,
          revenue: Math.round((monthlyRevenue._sum.finalAmount || 0) * 100) / 100,
          customers: monthlyUniqueCustomers,
          averageOrderValue: Math.round(monthlyAOV * 100) / 100,
          completionRate: monthlyOrders.length > 0 
            ? Math.round((monthlyCompletedOrders.length / monthlyOrders.length) * 100) 
            : 0
        },

        quarterly: {
          orders: quarterlyOrders.length,
          completedOrders: quarterlyCompletedOrders.length,
          revenue: Math.round((quarterlyRevenue._sum.finalAmount || 0) * 100) / 100,
          customers: quarterlyUniqueCustomers
        },

        allTime: {
          orders: laundry._count.orders,
          completedOrders: allCompletedOrders.length,
          revenue: Math.round((allTimeRevenue._sum.finalAmount || 0) * 100) / 100,
          customers: totalUniqueCustomers,
          averageOrderValue: Math.round(allTimeAOV * 100) / 100,
          totalProducts: laundry._count.products,
          totalReviews: laundry._count.reviews,
          averageRating
        },

        growth: {
          orders: Math.round(orderGrowth * 100) / 100,
          revenue: Math.round(revenueGrowth * 100) / 100
        }
      },

      // Données pour graphiques
      charts: {
        weeklyPerformance,
        orderStatusDistribution: Object.entries(orderStatusDistribution).map(([status, count]) => ({
          status,
          count,
          percentage: monthlyOrders.length > 0 ? Math.round((count as number / monthlyOrders.length) * 100) : 0
        })),
        ratingDistribution: Object.entries(ratingDistribution).map(([rating, count]) => ({
          rating: parseInt(rating),
          count,
          percentage: recentReviews.length > 0 ? Math.round((count as number / recentReviews.length) * 100) : 0
        }))
      },

      // Analyses détaillées
      analysis: {
        topProducts: topProductsWithNames,
        products: laundry.products.map(product => ({
          ...product,
          totalOrders: product._count.orderItems,
          isPopular: product._count.orderItems >= 10,
          status: product.isActive ? 'active' : 'inactive'
        })),
        
        businessHealth: {
          score: calculateBusinessHealthScore({
            monthlyOrders: monthlyOrders.length,
            completionRate: monthlyOrders.length > 0 ? (monthlyCompletedOrders.length / monthlyOrders.length) * 100 : 0,
            averageRating,
            revenueGrowth,
            customerRetention: quarterlyUniqueCustomers > 0 ? (monthlyUniqueCustomers / quarterlyUniqueCustomers) * 100 : 0
          }),
          indicators: {
            orderVolume: monthlyOrders.length >= 50 ? 'good' : monthlyOrders.length >= 20 ? 'fair' : 'poor',
            customerSatisfaction: averageRating >= 4.5 ? 'excellent' : averageRating >= 4.0 ? 'good' : averageRating >= 3.5 ? 'fair' : 'poor',
            growth: revenueGrowth >= 10 ? 'excellent' : revenueGrowth >= 0 ? 'good' : revenueGrowth >= -10 ? 'fair' : 'poor',
            efficiency: monthlyOrders.length > 0 && (monthlyCompletedOrders.length / monthlyOrders.length) >= 0.9 ? 'excellent' : 'fair'
          }
        }
      },

      // Activités et reviews récentes
      recentActivity: recentActivities.slice(0, 10).map(activity => ({
        type: activity.type,
        title: activity.title,
        description: activity.description,
        createdAt: activity.createdAt,
        metadata: activity.metadata
      })),

      recentReviews: recentReviews.slice(0, 5).map(review => ({
        id: review.id,
        rating: review.rating,
        comment: review.comment,
        createdAt: review.createdAt,
        customer: {
          name: review.customer.name || review.customer.email.split('@')[0],
          avatar: review.customer.avatar
        },
        orderNumber: review.order?.orderNumber
      })),

      metadata: {
        generatedAt: new Date().toISOString(),
        dataFreshness: 'real-time',
        coveragePeriod: {
          monthly: { from: thirtyDaysAgo.toISOString(), to: now.toISOString() },
          quarterly: { from: ninetyDaysAgo.toISOString(), to: now.toISOString() }
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Laundry details retrieved successfully',
      data: response,
      requestedBy: {
        userId: user.sub,
        role: user.role
      }
    })

  } catch (error) {
    console.error('Super Admin laundry details error:', error)
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Helper function pour calculer le score de santé de l'entreprise
function calculateBusinessHealthScore(metrics: {
  monthlyOrders: number
  completionRate: number
  averageRating: number
  revenueGrowth: number
  customerRetention: number
}): number {
  let score = 0
  
  // Volume de commandes (30%)
  if (metrics.monthlyOrders >= 100) score += 30
  else if (metrics.monthlyOrders >= 50) score += 25
  else if (metrics.monthlyOrders >= 20) score += 20
  else if (metrics.monthlyOrders >= 10) score += 15
  else if (metrics.monthlyOrders >= 5) score += 10
  else score += 5
  
  // Taux de completion (25%)
  if (metrics.completionRate >= 95) score += 25
  else if (metrics.completionRate >= 90) score += 22
  else if (metrics.completionRate >= 85) score += 18
  else if (metrics.completionRate >= 80) score += 15
  else if (metrics.completionRate >= 70) score += 10
  else score += 5
  
  // Note moyenne (20%)
  if (metrics.averageRating >= 4.8) score += 20
  else if (metrics.averageRating >= 4.5) score += 18
  else if (metrics.averageRating >= 4.0) score += 15
  else if (metrics.averageRating >= 3.5) score += 10
  else if (metrics.averageRating >= 3.0) score += 5
  else score += 1
  
  // Croissance du chiffre d'affaires (15%)
  if (metrics.revenueGrowth >= 20) score += 15
  else if (metrics.revenueGrowth >= 10) score += 12
  else if (metrics.revenueGrowth >= 5) score += 10
  else if (metrics.revenueGrowth >= 0) score += 8
  else if (metrics.revenueGrowth >= -10) score += 5
  else score += 2
  
  // Rétention client (10%)
  if (metrics.customerRetention >= 80) score += 10
  else if (metrics.customerRetention >= 60) score += 8
  else if (metrics.customerRetention >= 40) score += 6
  else if (metrics.customerRetention >= 20) score += 4
  else score += 2
  
  return Math.round(score)
}
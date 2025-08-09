// app/api/admin/dashboard/overview/route.ts - ADMIN uniquement
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole, successResponse, errorResponse } from '@/lib/auth-middleware'
import { z } from 'zod'

const querySchema = z.object({
  timeframe: z.enum(['week', 'month', 'quarter', 'year']).optional().default('month')
})

export async function GET(request: NextRequest) {
  const authResult = await requireRole(request, ['ADMIN'], { requireLaundry: true })
  
  if (authResult instanceof NextResponse) {
    return authResult
  }

  const { user } = authResult

  try {
    const { searchParams } = new URL(request.url)
    const queryParams = Object.fromEntries(searchParams.entries())
    
    const parsed = querySchema.safeParse(queryParams)
    if (!parsed.success) {
      return errorResponse('Invalid query parameters')
    }

    const { timeframe } = parsed.data

    // Calculer les dates pour la période
    const now = new Date()
    let startDate: Date
    let previousStartDate: Date

    switch (timeframe) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        previousStartDate = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
        break
      case 'quarter':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
        previousStartDate = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000)
        break
      case 'year':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
        previousStartDate = new Date(now.getTime() - 730 * 24 * 60 * 60 * 1000)
        break
      default: // month
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        previousStartDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)
    }

    // Requêtes pour les métriques actuelles
    const [
      totalOrders,
      completedOrders,
      totalRevenue,
      pendingOrders,
      totalCustomers,
      activeCustomers
    ] = await Promise.all([
      // Total commandes de la période
      prisma.order.count({
        where: {
          laundryId: user.laundryId,
          createdAt: { gte: startDate }
        }
      }),
      
      // Commandes terminées
      prisma.order.count({
        where: {
          laundryId: user.laundryId,
          status: { in: ['DELIVERED', 'COMPLETED'] },
          createdAt: { gte: startDate }
        }
      }),
      
      // Chiffre d'affaires
      prisma.order.aggregate({
        where: {
          laundryId: user.laundryId,
          status: { in: ['DELIVERED', 'COMPLETED'] },
          createdAt: { gte: startDate }
        },
        _sum: { finalAmount: true }
      }),
      
      // Commandes en attente
      prisma.order.count({
        where: {
          laundryId: user.laundryId,
          status: 'PENDING'
        }
      }),
      
      // Total clients (ayant passé au moins une commande)
      prisma.user.count({
        where: {
          role: 'CUSTOMER',
          orders: {
            some: {
              laundryId: user.laundryId
            }
          }
        }
      }),
      
      // Clients actifs (ayant commandé dans la période)
      prisma.user.count({
        where: {
          role: 'CUSTOMER',
          orders: {
            some: {
              laundryId: user.laundryId,
              createdAt: { gte: startDate }
            }
          }
        }
      })
    ])

    // Requêtes pour la période précédente (pour calculer les pourcentages)
    const [
      previousTotalOrders,
      previousRevenue,
      previousCustomers
    ] = await Promise.all([
      prisma.order.count({
        where: {
          laundryId: user.laundryId,
          createdAt: { 
            gte: previousStartDate,
            lt: startDate 
          }
        }
      }),
      
      prisma.order.aggregate({
        where: {
          laundryId: user.laundryId,
          status: { in: ['DELIVERED', 'COMPLETED'] },
          createdAt: { 
            gte: previousStartDate,
            lt: startDate 
          }
        },
        _sum: { finalAmount: true }
      }),
      
      prisma.user.count({
        where: {
          role: 'CUSTOMER',
          orders: {
            some: {
              laundryId: user.laundryId,
              createdAt: { 
                gte: previousStartDate,
                lt: startDate 
              }
            }
          }
        }
      })
    ])

    // Calculer les pourcentages de changement
    const calculateGrowth = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? 100 : 0
      return Number(((current - previous) / previous * 100).toFixed(1))
    }

    // Données pour les graphiques - Commandes par jour
    const dailyOrders = await prisma.order.groupBy({
      by: ['createdAt'],
      where: {
        laundryId: user.laundryId,
        createdAt: { gte: startDate }
      },
      _count: { id: true },
      orderBy: { createdAt: 'asc' }
    })

    // Données pour les graphiques - Revenus par semaine
    const weeklyRevenue = await prisma.order.groupBy({
      by: ['createdAt'],
      where: {
        laundryId: user.laundryId,
        status: { in: ['DELIVERED', 'COMPLETED'] },
        createdAt: { gte: startDate }
      },
      _sum: { finalAmount: true },
      orderBy: { createdAt: 'asc' }
    })

    // Services les plus populaires
    const popularServices = await prisma.orderItem.groupBy({
      by: ['productId'],
      where: {
        order: {
          laundryId: user.laundryId,
          createdAt: { gte: startDate }
        }
      },
      _count: { id: true },
      _sum: { quantity: true },
      orderBy: { _count: { id: 'desc' } },
      take: 5
    })

    // Récupérer les détails des produits populaires
    const productIds = popularServices.map(service => service.productId)
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, category: true }
    })

    const formattedPopularServices = popularServices.map(service => {
      const product = products.find(p => p.id === service.productId)
      return {
        productId: service.productId,
        productName: product?.name || 'Unknown',
        category: product?.category || 'Unknown',
        orderCount: service._count.id,
        totalQuantity: service._sum.quantity
      }
    })

    const overview = {
      // Métriques principales
      metrics: {
        totalOrders: {
          value: totalOrders,
          growth: calculateGrowth(totalOrders, previousTotalOrders),
          label: `Commandes (${timeframe})`
        },
        completedOrders: {
          value: completedOrders,
          percentage: totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 0,
          label: 'Commandes terminées'
        },
        totalRevenue: {
          value: totalRevenue._sum.finalAmount || 0,
          growth: calculateGrowth(
            totalRevenue._sum.finalAmount || 0,
            previousRevenue._sum.finalAmount || 0
          ),
          label: `Chiffre d'affaires (${timeframe})`
        },
        pendingOrders: {
          value: pendingOrders,
          label: 'Commandes en attente'
        },
        totalCustomers: {
          value: totalCustomers,
          label: 'Total clients'
        },
        activeCustomers: {
          value: activeCustomers,
          growth: calculateGrowth(activeCustomers, previousCustomers),
          label: `Clients actifs (${timeframe})`
        }
      },

      // Données pour les graphiques
      charts: {
        ordersTimeline: dailyOrders.map(order => ({
          date: order.createdAt,
          orders: order._count.id
        })),
        revenueTimeline: weeklyRevenue.map(revenue => ({
          date: revenue.createdAt,
          revenue: revenue._sum.finalAmount || 0
        })),
        popularServices: formattedPopularServices
      },

      // Informations contextuelles
      context: {
        timeframe,
        periodStart: startDate,
        periodEnd: now,
        laundryId: user.laundryId
      }
    }

    return successResponse(overview, 'Dashboard overview retrieved successfully')
  } catch (error) {
    console.error('Dashboard overview error:', error)
    return errorResponse('Failed to retrieve dashboard overview', 500)
  }
}

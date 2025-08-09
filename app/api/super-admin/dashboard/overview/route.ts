// app/api/super-admin/dashboard/overview/route.ts - SUPER_ADMIN uniquement
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole, successResponse, errorResponse } from '@/lib/auth-middleware'
import { z } from 'zod'

const querySchema = z.object({
  timeframe: z.enum(['week', 'month', 'quarter', 'year']).optional().default('month')
})

export async function GET(request: NextRequest) {
  const authResult = await requireRole(request, ['SUPER_ADMIN'])
  
  if (authResult instanceof NextResponse) {
    return authResult
  }

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

    // Métriques globales actuelles
    const [
      totalLaundries,
      activeLaundries,
      totalUsers,
      totalCustomers,
      totalOrders,
      completedOrders,
      platformRevenue,
      newUsersThisPeriod
    ] = await Promise.all([
      // Total laundries
      prisma.laundry.count(),
      
      // Laundries actives
      prisma.laundry.count({
        where: { status: 'ACTIVE' }
      }),
      
      // Total utilisateurs
      prisma.user.count(),
      
      // Total clients
      prisma.user.count({
        where: { role: 'CUSTOMER' }
      }),
      
      // Total commandes de la période
      prisma.order.count({
        where: { createdAt: { gte: startDate } }
      }),
      
      // Commandes terminées
      prisma.order.count({
        where: {
          status: { in: ['DELIVERED', 'COMPLETED'] },
          createdAt: { gte: startDate }
        }
      }),
      
      // Chiffre d'affaires de la plateforme
      prisma.order.aggregate({
        where: {
          status: { in: ['DELIVERED', 'COMPLETED'] },
          createdAt: { gte: startDate }
        },
        _sum: { finalAmount: true }
      }),
      
      // Nouveaux utilisateurs de la période
      prisma.user.count({
        where: { createdAt: { gte: startDate } }
      })
    ])

    // Métriques de la période précédente pour comparaison
    const [
      previousTotalOrders,
      previousRevenue,
      previousNewUsers
    ] = await Promise.all([
      prisma.order.count({
        where: {
          createdAt: { 
            gte: previousStartDate,
            lt: startDate 
          }
        }
      }),
      
      prisma.order.aggregate({
        where: {
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
          createdAt: { 
            gte: previousStartDate,
            lt: startDate 
          }
        }
      })
    ])

    // Fonction pour calculer la croissance
    const calculateGrowth = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? 100 : 0
      return Number(((current - previous) / previous * 100).toFixed(1))
    }

    // Top performing laundries
    const topLaundries = await prisma.laundry.findMany({
      where: { status: 'ACTIVE' },
      include: {
        _count: {
          select: {
            orders: {
              where: {
                status: { in: ['DELIVERED', 'COMPLETED'] },
                createdAt: { gte: startDate }
              }
            }
          }
        },
        orders: {
          where: {
            status: { in: ['DELIVERED', 'COMPLETED'] },
            createdAt: { gte: startDate }
          },
          select: {
            finalAmount: true
          }
        }
      },
      take: 5
    })

    const formattedTopLaundries = topLaundries.map(laundry => ({
      id: laundry.id,
      name: laundry.name,
      ordersCount: laundry._count.orders,
      revenue: laundry.orders.reduce((sum, order) => sum + order.finalAmount, 0),
      status: laundry.status
    })).sort((a, b) => b.revenue - a.revenue)

    // Distribution des commandes par statut
    const orderStatusDistribution = await prisma.order.groupBy({
      by: ['status'],
      where: { createdAt: { gte: startDate } },
      _count: { id: true }
    })

    // Évolution des inscriptions
    const userGrowth = await Promise.all(
      Array.from({ length: 7 }, async (_, i) => {
        const date = new Date(startDate.getTime() + (i * (now.getTime() - startDate.getTime()) / 7))
        const nextDate = new Date(startDate.getTime() + ((i + 1) * (now.getTime() - startDate.getTime()) / 7))
        
        const count = await prisma.user.count({
          where: {
            createdAt: {
              gte: date,
              lt: nextDate
            }
          }
        })
        
        return {
          date,
          newUsers: count
        }
      })
    )

    const overview = {
      // Métriques principales
      metrics: {
        totalLaundries: {
          value: totalLaundries,
          active: activeLaundries,
          label: 'Total Laundries'
        },
        totalUsers: {
          value: totalUsers,
          customers: totalCustomers,
          growth: calculateGrowth(newUsersThisPeriod, previousNewUsers),
          label: `Utilisateurs (${timeframe})`
        },
        totalOrders: {
          value: totalOrders,
          completed: completedOrders,
          completionRate: totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 0,
          growth: calculateGrowth(totalOrders, previousTotalOrders),
          label: `Commandes (${timeframe})`
        },
        platformRevenue: {
          value: platformRevenue._sum.finalAmount || 0,
          growth: calculateGrowth(
            platformRevenue._sum.finalAmount || 0,
            previousRevenue._sum.finalAmount || 0
          ),
          label: `Revenus Plateforme (${timeframe})`
        }
      },

      // Top performing laundries
      topPerformingLaundries: formattedTopLaundries,

      // Distribution des statuts de commandes
      orderStatusBreakdown: orderStatusDistribution.map(status => ({
        status: status.status,
        count: status._count.id,
        percentage: totalOrders > 0 ? Math.round((status._count.id / totalOrders) * 100) : 0
      })),

      // Croissance des utilisateurs
      userGrowthTimeline: userGrowth,

      // Informations contextuelles
      context: {
        timeframe,
        periodStart: startDate,
        periodEnd: now,
        platformHealth: {
          activeLaundriesRatio: totalLaundries > 0 ? Math.round((activeLaundries / totalLaundries) * 100) : 0,
          averageOrdersPerLaundry: activeLaundries > 0 ? Math.round(totalOrders / activeLaundries) : 0,
          averageRevenuePerLaundry: activeLaundries > 0 ? Math.round((platformRevenue._sum.finalAmount || 0) / activeLaundries) : 0
        }
      }
    }

    return successResponse(overview, 'Super admin dashboard overview retrieved successfully')
  } catch (error) {
    console.error('Super admin dashboard overview error:', error)
    return errorResponse('Failed to retrieve dashboard overview', 500)
  }
}
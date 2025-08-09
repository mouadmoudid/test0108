// app/api/super-admin/laundries/performance/route.ts - SUPER_ADMIN uniquement
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole, successResponse, errorResponse } from '@/lib/auth-middleware'
import { z } from 'zod'

const performanceQuerySchema = z.object({
  page: z.coerce.number().min(1).optional().default(1),
  limit: z.coerce.number().min(1).max(50).optional().default(20),
  sortBy: z.enum(['ordersMonth', 'customers', 'revenue', 'rating']).optional().default('revenue'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  status: z.enum(['ALL', 'ACTIVE', 'INACTIVE', 'SUSPENDED']).optional().default('ALL')
})

export async function GET(request: NextRequest) {
  const authResult = await requireRole(request, ['SUPER_ADMIN'])
  
  if (authResult instanceof NextResponse) {
    return authResult
  }

  try {
    const { searchParams } = new URL(request.url)
    const queryParams = Object.fromEntries(searchParams.entries())
    
    const parsed = performanceQuerySchema.safeParse(queryParams)
    if (!parsed.success) {
      return errorResponse('Invalid query parameters')
    }

    const { page, limit, sortBy, sortOrder, status } = parsed.data
    const offset = (page - 1) * limit

    // Date pour le mois dernier
    const lastMonth = new Date()
    lastMonth.setMonth(lastMonth.getMonth() - 1)

    // Conditions de filtrage
    const where: any = {}
    if (status !== 'ALL') {
      where.status = status
    }

    const laundries = await prisma.laundry.findMany({
      where,
      include: {
        admin: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true
          }
        },
        orders: {
          where: {
            createdAt: { gte: lastMonth },
            status: { in: ['DELIVERED', 'COMPLETED'] }
          },
          select: {
            finalAmount: true,
            customerId: true
          }
        },
        _count: {
          select: {
            orders: {
              where: {
                createdAt: { gte: lastMonth }
              }
            }
          }
        }
      },
      skip: offset,
      take: limit
    })

    // Calculer les métriques pour chaque laundry
    const laundriesWithMetrics = await Promise.all(
      laundries.map(async (laundry) => {
        // Revenus du mois
        const monthlyRevenue = laundry.orders.reduce((sum, order) => sum + order.finalAmount, 0)
        
        // Clients uniques du mois
        const uniqueCustomers = new Set(laundry.orders.map(order => order.customerId)).size
        
        // Total clients
        const totalCustomers = await prisma.user.count({
          where: {
            role: 'CUSTOMER',
            orders: {
              some: {
                laundryId: laundry.id
              }
            }
          }
        })

        // Rating moyen (simulation - vous devriez avoir une vraie logique de rating)
        const averageRating = await prisma.review.aggregate({
          where: {
            order: {
              laundryId: laundry.id
            }
          },
          _avg: { rating: true }
        })

        // Commandes en retard
        const overdueOrders = await prisma.order.count({
          where: {
            laundryId: laundry.id,
            status: { in: ['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY'] },
            deliveryDate: { lt: new Date() }
          }
        })

        return {
          id: laundry.id,
          name: laundry.name,
          email: laundry.email,
          phone: laundry.phone,
          status: laundry.status,
          createdAt: laundry.createdAt,
          
          // Admin info
          admin: laundry.admin,
          
          // Métriques de performance
          metrics: {
            ordersMonth: laundry._count.orders,
            revenue: monthlyRevenue,
            customers: totalCustomers,
            activeCustomersMonth: uniqueCustomers,
            rating: Number((averageRating._avg.rating || 0).toFixed(1)),
            overdueOrders,
            
            // Ratios calculés
            revenuePerOrder: laundry._count.orders > 0 ? Math.round(monthlyRevenue / laundry._count.orders) : 0,
            revenuePerCustomer: uniqueCustomers > 0 ? Math.round(monthlyRevenue / uniqueCustomers) : 0,
            customerRetentionRate: totalCustomers > 0 ? Math.round((uniqueCustomers / totalCustomers) * 100) : 0
          },
          
          // Statut de santé
          healthStatus: {
            overall: overdueOrders === 0 && laundry._count.orders > 0 ? 'excellent' :
                    overdueOrders <= 2 && laundry._count.orders > 0 ? 'good' :
                    laundry._count.orders > 0 ? 'warning' : 'poor',
            hasOverdueOrders: overdueOrders > 0,
            isActive: laundry.status === 'ACTIVE',
            needsAttention: overdueOrders > 5 || (averageRating._avg.rating || 0) < 3
          }
        }
      })
    )

    // Trier selon les critères
    laundriesWithMetrics.sort((a, b) => {
      let aValue: number, bValue: number
      
      switch (sortBy) {
        case 'ordersMonth':
          aValue = a.metrics.ordersMonth
          bValue = b.metrics.ordersMonth
          break
        case 'customers':
          aValue = a.metrics.customers
          bValue = b.metrics.customers
          break
        case 'rating':
          aValue = a.metrics.rating
          bValue = b.metrics.rating
          break
        default: // revenue
          aValue = a.metrics.revenue
          bValue = b.metrics.revenue
      }
      
      return sortOrder === 'desc' ? bValue - aValue : aValue - bValue
    })

    const totalCount = await prisma.laundry.count({ where })
    const totalPages = Math.ceil(totalCount / limit)

    return successResponse({
      laundries: laundriesWithMetrics,
      pagination: {
        currentPage: page,
        totalPages,
        totalCount,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1
      },
      summary: {
        totalLaundries: totalCount,
        activeLaundries: laundriesWithMetrics.filter(l => l.status === 'ACTIVE').length,
        totalRevenue: laundriesWithMetrics.reduce((sum, l) => sum + l.metrics.revenue, 0),
        averageRating: Number((laundriesWithMetrics.reduce((sum, l) => sum + l.metrics.rating, 0) / laundriesWithMetrics.length).toFixed(1)) || 0
      }
    }, 'Laundries performance retrieved successfully')
  } catch (error) {
    console.error('Laundries performance error:', error)
    return errorResponse('Failed to retrieve laundries performance', 500)
  }
}

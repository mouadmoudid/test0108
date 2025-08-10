// app/api/user/orders/history/route.ts - CUSTOMER uniquement (CORRIGÉ)
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole, successResponse, errorResponse } from '@/lib/auth-middleware'
import { z } from 'zod'

const historyQuerySchema = z.object({
  page: z.coerce.number().min(1).optional().default(1),
  limit: z.coerce.number().min(1).max(50).optional().default(20),
  status: z.enum(['ALL', 'DELIVERED', 'COMPLETED', 'CANCELED']).optional().default('ALL'),
  search: z.string().optional()
})

export async function GET(request: NextRequest) {
  const authResult = await requireRole(request, ['CUSTOMER'])
  
  if (authResult instanceof NextResponse) {
    return authResult
  }

  const { user } = authResult

  try {
    const { searchParams } = new URL(request.url)
    const queryParams = Object.fromEntries(searchParams.entries())
    
    const parsed = historyQuerySchema.safeParse(queryParams)
    if (!parsed.success) {
      return errorResponse('Invalid query parameters')
    }

    const { page, limit, status, search } = parsed.data
    const offset = (page - 1) * limit

    // ✅ CORRECTION: Utiliser customerId au lieu de userId
    const where: any = {
      customerId: user.sub, // ✅ CORRIGÉ: customerId au lieu de userId
      status: {
        in: ['DELIVERED', 'COMPLETED', 'CANCELED', 'REFUNDED']
      }
    }

    if (status !== 'ALL') {
      where.status = status
    }

    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { 
          orderItems: {
            some: {
              product: {
                name: { contains: search, mode: 'insensitive' }
              }
            }
          }
        }
      ]
    }

    const [orders, totalCount] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          orderItems: {
            include: {
              product: {
                select: {
                  name: true,
                  category: true
                }
              }
            }
          },
          laundry: {
            select: {
              name: true
            }
          },
          reviews: {
            select: {
              id: true,
              rating: true
            },
            take: 1
          }
        },
        orderBy: {
          createdAt: 'desc'
        },
        skip: offset,
        take: limit
      }),
      prisma.order.count({ where })
    ])

    const formattedOrders = orders.map(order => {
      const primaryService = order.orderItems[0]?.product.category || 'General Service'
      const totalItems = order.orderItems.reduce((sum, item) => sum + item.quantity, 0)
      
      return {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        primaryService,
        totalItems,
        finalAmount: order.finalAmount,
        
        laundry: {
          name: order.laundry.name
        },
        
        dates: {
          orderDate: order.createdAt,
          deliveredDate: order.status === 'DELIVERED' ? order.deliveryDate : null
        },
        
        actions: {
          canReview: ['DELIVERED', 'COMPLETED'].includes(order.status) && !order.reviews.length,
          canReorder: ['DELIVERED', 'COMPLETED'].includes(order.status),
          hasReview: !!order.reviews.length,
          rating: order.reviews[0]?.rating || null
        }
      }
    })

    const totalPages = Math.ceil(totalCount / limit)

    return successResponse({
      orders: formattedOrders,
      pagination: {
        currentPage: page,
        totalPages,
        totalCount,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1
      }
    }, 'Order history retrieved successfully')
  } catch (error) {
    console.error('Get order history error:', error)
    return errorResponse('Failed to retrieve order history', 500)
  }
}
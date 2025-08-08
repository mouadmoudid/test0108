// app/api/user/orders/history/route.ts
import { prisma } from '@/lib/prisma'
import { paginatedResponse, errorResponse } from '@/lib/response'
import { orderQuerySchema, validateQuery } from '@/lib/validations'
import { NextRequest } from 'next/server'

// GET /api/user/orders/history?userId=xxx&page=1&limit=10
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')

    if (!userId) {
      return errorResponse('userId parameter is required', 400)
    }

    const queryParams = Object.fromEntries(searchParams.entries())
    const validatedQuery = validateQuery(orderQuerySchema, queryParams)
    
    if (!validatedQuery) {
      return errorResponse('Invalid query parameters', 400)
    }

    const { page = 1, limit = 10, search, status } = validatedQuery

    // Calculate offset
    const offset = (page - 1) * limit

    // Build where clause
    const whereClause: any = {
      customerId: userId
    }

    // Add search filter
    if (search) {
      whereClause.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { 
          laundry: { 
            name: { contains: search, mode: 'insensitive' } 
          } 
        }
      ]
    }

    // Add status filter
    if (status) {
      whereClause.status = status
    }

    // Get orders with pagination
    const [orders, totalCount] = await Promise.all([
      prisma.order.findMany({
        where: whereClause,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          finalAmount: true,
          createdAt: true,
          deliveryDate: true,
          laundry: {
            select: {
              name: true,
              logo: true,
              rating: true
            }
          },
          address: {
            select: {
              street: true,
              city: true,
              state: true
            }
          },
          _count: {
            select: {
              orderItems: true
            }
          },
          reviews: {
            select: {
              id: true,
              rating: true,
              comment: true
            },
            take: 1
          }
        },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit
      }),

      prisma.order.count({
        where: whereClause
      })
    ])

    const totalPages = Math.ceil(totalCount / limit)

    const formattedOrders = orders.map(order => ({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      placedDate: order.createdAt,
      deliveryDate: order.deliveryDate,
      itemCount: order._count.orderItems,
      totalCost: order.finalAmount,
      laundry: order.laundry,
      deliveryAddress: `${order.address.street}, ${order.address.city}, ${order.address.state}`,
      review: order.reviews[0] || null,
      canReorder: ['DELIVERED', 'COMPLETED'].includes(order.status),
      canReview: ['DELIVERED', 'COMPLETED'].includes(order.status) && !order.reviews[0]
    }))

    return paginatedResponse(
      formattedOrders,
      {
        page,
        limit,
        total: totalCount,
        totalPages
      },
      'Order history retrieved successfully'
    )
  } catch (error) {
    console.error('Get order history error:', error)
    return errorResponse('Failed to retrieve order history', 500)
  }
}
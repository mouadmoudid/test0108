import { prisma } from '@/lib/prisma'
import { paginatedResponse, errorResponse } from '@/lib/response'
import { orderQuerySchema, validateQuery } from '@/lib/validations'
import { NextRequest } from 'next/server'

// GET /api/admin/laundries/[laundryId]/orders
export async function GET(
  request: NextRequest,
  { params }: { params: { laundryId: string } }
) {
  try {
    const { laundryId } = params
    const { searchParams } = new URL(request.url)
    const queryParams = Object.fromEntries(searchParams.entries())
    
    const validatedQuery = validateQuery(orderQuerySchema, queryParams)
    if (!validatedQuery) {
      return errorResponse('Invalid query parameters', 400)
    }

    const { page, limit, search, status, startDate, endDate } = validatedQuery

    // Check if laundry exists
    const laundry = await prisma.laundry.findUnique({
      where: { id: laundryId }
    })

    if (!laundry) {
      return errorResponse('Laundry not found', 404)
    }

    // Calculate offset
    const offset = ((page ?? 1) - 1) * (limit ?? 10)

    // Build where clause
    const whereClause: any = {
      laundryId: laundryId
    }

    // Add search filter
    if (search) {
      whereClause.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { customer: { email: { contains: search, mode: 'insensitive' } } }
      ]
    }

    // Add status filter
    if (status) {
      whereClause.status = status
    }

    // Add date range filter
    if (startDate || endDate) {
      whereClause.createdAt = {}
      if (startDate) {
        whereClause.createdAt.gte = new Date(startDate)
      }
      if (endDate) {
        whereClause.createdAt.lte = new Date(endDate)
      }
    }

    // Get orders with pagination
    const [orders, totalCount] = await Promise.all([
      prisma.order.findMany({
        where: whereClause,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          totalAmount: true,
          deliveryFee: true,
          discount: true,
          finalAmount: true,
          notes: true,
          pickupDate: true,
          deliveryDate: true,
          createdAt: true,
          updatedAt: true,
          customer: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              avatar: true
            }
          },
          address: {
            select: {
              street: true,
              city: true,
              state: true,
              zipCode: true
            }
          },
          orderItems: {
            select: {
              id: true,
              quantity: true,
              price: true,
              totalPrice: true,
              product: {
                select: {
                  name: true,
                  category: true,
                  unit: true
                }
              }
            }
          },
          _count: {
            select: {
              orderItems: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),

      prisma.order.count({
        where: whereClause
      })
    ])

    const totalPages = Math.ceil(totalCount / (limit ?? 10))

    // Format the response
    const formattedOrders = orders.map(order => ({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      customer: {
        id: order.customer.id,
        name: order.customer.name,
        email: order.customer.email,
        phone: order.customer.phone,
        avatar: order.customer.avatar
      },
      address: {
        street: order.address.street,
        city: order.address.city,
        state: order.address.state,
        zipCode: order.address.zipCode
      },
      orderSummary: {
        totalAmount: order.totalAmount,
        deliveryFee: order.deliveryFee,
        discount: order.discount,
        finalAmount: order.finalAmount,
        itemCount: order._count.orderItems
      },
      orderItems: order.orderItems.map(item => ({
        id: item.id,
        productName: item.product.name,
        category: item.product.category,
        quantity: item.quantity,
        unit: item.product.unit,
        price: item.price,
        totalPrice: item.totalPrice
      })),
      dates: {
        orderDate: order.createdAt,
        pickupDate: order.pickupDate,
        deliveryDate: order.deliveryDate,
        lastUpdated: order.updatedAt
      },
      notes: order.notes
    }))

    return paginatedResponse(
      formattedOrders,
      {
        page: page ?? 1,
        limit: limit ?? 10,
        total: totalCount,
        totalPages
      },
      'Laundry orders retrieved successfully'
    )
  } catch (error) {
    console.error('Laundry orders error:', error)
    return errorResponse('Failed to retrieve laundry orders', 500)
  }
}
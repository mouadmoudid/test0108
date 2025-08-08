import { prisma } from '@/lib/prisma'
import { errorResponse } from '@/lib/response'
import { orderQuerySchema, validateQuery } from '@/lib/validations'
import { NextRequest, NextResponse } from 'next/server'

// GET /api/admin/orders
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const queryParams = Object.fromEntries(searchParams.entries())
    
    const validatedQuery = validateQuery(orderQuerySchema, queryParams)
    if (!validatedQuery) {
      return errorResponse('Invalid query parameters', 400)
    }

    const { page, limit, search, status, startDate, endDate } = validatedQuery

    // Calculate offset
    const safePage = page ?? 1
    const safeLimit = limit ?? 10
    const offset = (safePage - 1) * safeLimit

    // Build where clause
    const whereClause: any = {}

    // Add search filter
    if (search) {
      whereClause.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { customer: { email: { contains: search, mode: 'insensitive' } } },
        { laundry: { name: { contains: search, mode: 'insensitive' } } }
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
          laundry: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              logo: true,
              status: true
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

    const totalPages = Math.ceil(totalCount / (limit ?? 1))

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
      laundry: {
        id: order.laundry.id,
        name: order.laundry.name,
        email: order.laundry.email,
        phone: order.laundry.phone,
        logo: order.laundry.logo,
        status: order.laundry.status
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

    // Get order statistics for summary
    const orderStats = await prisma.order.groupBy({
      by: ['status'],
      _count: { status: true },
      where: whereClause
    })

    const summary = {
      totalOrders: totalCount,
      statusDistribution: orderStats.map(stat => ({
        status: stat.status,
        count: stat._count.status
      }))
    }

    return NextResponse.json({
      success: true,
      message: 'Orders retrieved successfully',
      data: formattedOrders,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages
      },
      summary,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('Admin orders error:', error)
    return errorResponse('Failed to retrieve orders', 500)
  }
}
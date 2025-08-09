// app/api/admin/customers/[customerId]/orders/route.ts - CORRIGÉ avec customerId
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-middleware'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

// Helpers de réponse
const successResponse = (data: any, message: string = 'Success') => {
  return NextResponse.json({
    success: true,
    message,
    data
  })
}

const errorResponse = (message: string, status: number = 400) => {
  return NextResponse.json(
    { success: false, message },
    { status }
  )
}

// Query schema for customer orders
const customerOrdersQuerySchema = z.object({
  page: z.coerce.number().min(1).optional().default(1),
  limit: z.coerce.number().min(1).max(100).optional().default(20),
  status: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  sortBy: z.enum(['createdAt', 'finalAmount', 'status']).optional().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc')
})

export async function GET(
  request: NextRequest,
  { params }: { params: { customerId: string } }
) {
  try {
    // Authentification
    const authResult = await requireRole(request, ['ADMIN'], { requireLaundry: true })
    
    if (authResult instanceof NextResponse) {
      return authResult
    }

    const { user } = authResult

    if (!user.sub || !user.laundryId) {
      return errorResponse('Invalid user session or missing laundry association', 401)
    }

    const { customerId } = params
    const { searchParams } = new URL(request.url)
    const laundryId = user.laundryId

    // Verify customer exists AND belongs to this laundry
    const customer = await prisma.user.findFirst({
      where: { 
        id: customerId,
        role: 'CUSTOMER',
        orders: {
          some: {
            laundryId: laundryId
          }
        }
      },
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
        createdAt: true
      }
    })

    if (!customer) {
      return errorResponse('Customer not found or not associated with your laundry', 404)
    }

    // Validate query parameters
    const queryParams = Object.fromEntries(searchParams.entries())
    
    const parsed = customerOrdersQuerySchema.safeParse(queryParams)
    if (!parsed.success) {
      return errorResponse('Invalid query parameters', 400)
    }

    const { page, limit, status, startDate, endDate, sortBy, sortOrder } = parsed.data

    // Build where conditions - CORRECTION: customerId au lieu de userId
    const whereConditions: any = {
      customerId: customerId, // ✅ CORRIGÉ
      laundryId
    }

    if (status) {
      whereConditions.status = status
    }

    if (startDate || endDate) {
      whereConditions.createdAt = {}
      if (startDate) {
        whereConditions.createdAt.gte = new Date(startDate)
      }
      if (endDate) {
        whereConditions.createdAt.lte = new Date(endDate)
      }
    }

    // Get total count for pagination
    const totalCount = await prisma.order.count({
      where: whereConditions
    })

    // Calculate offset
    const offset = (page - 1) * limit

    // Get orders with details
    const orders = await prisma.order.findMany({
      where: whereConditions,
      include: {
        orderItems: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                category: true,
                unit: true
              }
            }
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
        reviews: {
          select: {
            id: true,
            rating: true,
            comment: true,
            createdAt: true
          },
          take: 1
        }
      },
      orderBy: {
        [sortBy]: sortOrder
      },
      skip: offset,
      take: limit
    })

    // Format orders for response
    const formattedOrders = orders.map(order => {
      // Get service categories
      const services = Array.from(new Set(order.orderItems.map(item => item.product?.category || 'Unknown')))
      const primaryService = services[0] || 'General Service'
      
      // Calculate total items
      const totalItems = order.orderItems.reduce((sum: number, item: any) => sum + item.quantity, 0)
      
      // Calculate days since order
      const daysSinceOrder = Math.floor(
        (new Date().getTime() - order.createdAt.getTime()) / (1000 * 60 * 60 * 24)
      )
      
      // Check if overdue
      const isOverdue = order.deliveryDate && 
        order.deliveryDate < new Date() && 
        !['DELIVERED', 'COMPLETED', 'CANCELED'].includes(order.status)

      return {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        primaryService,
        services,
        totalItems,
        totalAmount: order.totalAmount,
        deliveryFee: order.deliveryFee || 0,
        discount: order.discount || 0,
        finalAmount: order.finalAmount,
        deliveryAddress: order.address ? {
          street: order.address.street,
          city: order.address.city,
          state: order.address.state,
          zipCode: order.address.zipCode
        } : null,
        dates: {
          orderDate: order.createdAt,
          pickupDate: order.pickupDate,
          deliveryDate: order.deliveryDate,
          daysSinceOrder
        },
        items: order.orderItems.map((item: any) => ({
          id: item.id,
          productName: item.product?.name || 'Unknown Product',
          category: item.product?.category || 'Unknown',
          quantity: item.quantity,
          unit: item.product?.unit || 'unit',
          unitPrice: item.price,
          totalPrice: item.totalPrice
        })),
        review: order.reviews[0] || null,
        canReview: ['DELIVERED', 'COMPLETED'].includes(order.status) && !order.reviews[0],
        isOverdue,
        priority: isOverdue ? 'high' : 
                 ['PENDING', 'CONFIRMED'].includes(order.status) ? 'medium' : 'normal',
        notes: order.notes
      }
    })

    // Calculate pagination info
    const totalPages = Math.ceil(totalCount / limit)
    const hasNextPage = page < totalPages
    const hasPrevPage = page > 1

    // Get customer summary statistics - CORRECTION: customerId au lieu de userId
    const allCustomerOrders = await prisma.order.findMany({
      where: {
        customerId: customerId, // ✅ CORRIGÉ
        laundryId
      },
      select: {
        finalAmount: true,
        status: true,
        createdAt: true
      }
    })

    const customerStats = {
      totalOrders: allCustomerOrders.length,
      totalSpent: allCustomerOrders.reduce((sum, order) => sum + order.finalAmount, 0),
      completedOrders: allCustomerOrders.filter(order => 
        ['COMPLETED', 'DELIVERED'].includes(order.status)
      ).length,
      canceledOrders: allCustomerOrders.filter(order => order.status === 'CANCELED').length,
      averageOrderValue: allCustomerOrders.length > 0 ? 
        allCustomerOrders.reduce((sum, order) => sum + order.finalAmount, 0) / allCustomerOrders.length : 0,
      firstOrderDate: allCustomerOrders.length > 0 ? 
        allCustomerOrders.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0].createdAt : null,
      lastOrderDate: allCustomerOrders.length > 0 ? 
        allCustomerOrders.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0].createdAt : null
    }

    // Get status distribution for this customer
    const statusDistribution = allCustomerOrders.reduce((acc: any, order) => {
      acc[order.status] = (acc[order.status] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    const response = {
      customer: {
        id: customer.id,
        name: customer.name || customer.email.split('@')[0],
        email: customer.email,
        avatar: customer.avatar,
        memberSince: customer.createdAt,
        stats: customerStats
      },
      orders: formattedOrders,
      pagination: {
        currentPage: page,
        totalPages,
        totalCount,
        limit,
        hasNextPage,
        hasPrevPage,
        showing: formattedOrders.length
      },
      summary: {
        statusDistribution,
        totalOrdersInPeriod: totalCount,
        totalRevenueInPeriod: formattedOrders.reduce((sum, order) => sum + order.finalAmount, 0)
      },
      filters: {
        status,
        dateRange: startDate || endDate ? { startDate, endDate } : null,
        sortBy,
        sortOrder
      }
    }

    return successResponse(response, 'Customer orders retrieved successfully')
  } catch (error) {
    console.error('Get customer orders error:', error)
    return errorResponse('Failed to retrieve customer orders', 500)
  }
}
// app/api/admin/dashboard/recent-orders/route.ts
import { prisma } from '@/lib/prisma'
import { successResponse, errorResponse } from '@/lib/response'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '5')
    const laundryId = searchParams.get('laundryId')

    if (!laundryId) {
      return errorResponse('laundryId parameter is required', 400)
    }

    // Verify laundry exists
    const laundry = await prisma.laundry.findUnique({
      where: { id: laundryId }
    })

    if (!laundry) {
      return errorResponse('Laundry not found', 404)
    }

    // Get recent orders
    const recentOrders = await prisma.order.findMany({
      where: { laundryId },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true
          }
        },
        orderItems: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                category: true
              }
            }
          }
        },
        address: {
          select: {
            street: true,
            city: true,
            state: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: limit
    })

    // Format the response
    const formattedOrders = recentOrders.map(order => {
      // Get primary service category
      const categories = order.orderItems.map(item => item.product.category)
      const primaryCategory = categories[0] || 'General'
      
      // Calculate total items
      const totalItems = order.orderItems.reduce((sum, item) => sum + item.quantity, 0)
      
      // Determine urgency based on status and dates
      let urgency = 'normal'
      if (order.status === 'PENDING') urgency = 'high'
      else if (['IN_PROGRESS', 'READY_FOR_PICKUP'].includes(order.status)) urgency = 'medium'
      else if (['DELIVERED', 'COMPLETED'].includes(order.status)) urgency = 'low'
      
      return {
        id: order.id,
        orderNumber: order.orderNumber,
        customer: {
          id: order.customer.id,
          name: order.customer.name || order.customer.email,
          email: order.customer.email,
          avatar: order.customer.avatar
        },
        status: order.status,
        urgency,
        service: primaryCategory,
        totalItems,
        totalAmount: order.finalAmount,
        deliveryAddress: {
          street: order.address.street,
          city: order.address.city,
          state: order.address.state
        },
        dates: {
          orderDate: order.createdAt,
          pickupDate: order.pickupDate,
          deliveryDate: order.deliveryDate
        },
        estimatedCompletion: order.deliveryDate || 
          new Date(order.createdAt.getTime() + 48 * 60 * 60 * 1000), // Default 48 hours
        isOverdue: order.deliveryDate && order.deliveryDate < new Date() && 
          !['DELIVERED', 'COMPLETED', 'CANCELED'].includes(order.status)
      }
    })

    // Get summary stats for context
    const totalActiveOrders = await prisma.order.count({
      where: {
        laundryId,
        status: {
          in: ['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY']
        }
      }
    })

    const overdueOrders = await prisma.order.count({
      where: {
        laundryId,
        deliveryDate: {
          lt: new Date()
        },
        status: {
          notIn: ['DELIVERED', 'COMPLETED', 'CANCELED']
        }
      }
    })

    const todayOrders = await prisma.order.count({
      where: {
        laundryId,
        createdAt: {
          gte: new Date(new Date().setHours(0, 0, 0, 0))
        }
      }
    })

    const response = {
      orders: formattedOrders,
      summary: {
        totalActive: totalActiveOrders,
        overdue: overdueOrders,
        todayOrders,
        showing: formattedOrders.length,
        limit
      }
    }

    return successResponse(response, 'Recent orders retrieved successfully')
  } catch (error) {
    console.error('Recent orders error:', error)
    return errorResponse('Failed to retrieve recent orders', 500)
  }
}
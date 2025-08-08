// app/api/admin/orders/[orderId]/route.ts
import { prisma } from '@/lib/prisma'
import { successResponse, errorResponse } from '@/lib/response'
import { NextRequest } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: { orderId: string } }
) {
  try {
    const { orderId } = params
    const { searchParams } = new URL(request.url)
    const laundryId = searchParams.get('laundryId')

    if (!laundryId) {
      return errorResponse('laundryId parameter is required', 400)
    }

    // Get comprehensive order details
    const order = await prisma.order.findFirst({
      where: { 
        id: orderId,
        laundryId // Ensure order belongs to this laundry
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            avatar: true,
            createdAt: true,
            _count: {
              select: {
                orders: true,
                reviews: true
              }
            }
          }
        },
        address: {
          select: {
            id: true,
            street: true,
            city: true,
            state: true,
            zipCode: true,
            latitude: true,
            longitude: true
          }
        },
        orderItems: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                description: true,
                category: true,
                unit: true
              }
            }
          }
        },
        activities: {
          select: {
            id: true,
            type: true,
            title: true,
            description: true,
            metadata: true,
            createdAt: true
          },
          orderBy: { createdAt: 'desc' }
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
      }
    })

    if (!order) {
      return errorResponse('Order not found or does not belong to this laundry', 404)
    }

    // Get customer statistics
    const customerStats = await prisma.order.aggregate({
      where: { 
        customerId: order.customerId,
        laundryId // Only orders from this laundry
      },
      _sum: { finalAmount: true },
      _count: { id: true }
    })

    // Build status timeline from activities
    const statusTimeline = order.activities
      .filter(activity => activity.type.includes('ORDER'))
      .map(activity => ({
        status: activity.type.replace('ORDER_', ''),
        timestamp: activity.createdAt,
        title: activity.title,
        description: activity.description
      }))
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())

    // Calculate delivery progress
    const statusOrder = ['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED']
    const currentStatusIndex = statusOrder.indexOf(order.status)
    const progressPercentage = currentStatusIndex >= 0 ? 
      ((currentStatusIndex + 1) / statusOrder.length) * 100 : 0

    // Format the comprehensive order details
    const orderDetails = {
      // Basic Order Information
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      
      // Financial Information
      pricing: {
        totalAmount: order.totalAmount,
        deliveryFee: order.deliveryFee || 0,
        discount: order.discount || 0,
        finalAmount: order.finalAmount
      },
      
      // Customer Information
      customer: {
        id: order.customer.id,
        name: order.customer.name || order.customer.email.split('@')[0],
        email: order.customer.email,
        phone: order.customer.phone,
        avatar: order.customer.avatar,
        memberSince: order.customer.createdAt,
        stats: {
          totalOrdersWithLaundry: customerStats._count.id,
          totalSpentWithLaundry: customerStats._sum.finalAmount || 0,
          totalOrdersOverall: order.customer._count.orders,
          totalReviews: order.customer._count.reviews
        }
      },
      
      // Delivery Information
      deliveryAddress: {
        id: order.address.id,
        street: order.address.street,
        city: order.address.city,
        state: order.address.state,
        zipCode: order.address.zipCode,
        coordinates: order.address.latitude && order.address.longitude ? {
          latitude: order.address.latitude,
          longitude: order.address.longitude
        } : null
      },
      
      // Order Items
      items: order.orderItems.map(item => ({
        id: item.id,
        product: {
          id: item.product.id,
          name: item.product.name,
          description: item.product.description,
          category: item.product.category,
          unit: item.product.unit
        },
        quantity: item.quantity,
        unitPrice: item.price,
        totalPrice: item.totalPrice
      })),
      
      // Order Summary
      summary: {
        totalItems: order.orderItems.length,
        totalQuantity: order.orderItems.reduce((sum, item) => sum + item.quantity, 0),
        categories: Array.from(new Set(order.orderItems.map(item => item.product.category))),
        averageItemPrice: order.orderItems.length > 0 ? 
          order.orderItems.reduce((sum, item) => sum + item.price, 0) / order.orderItems.length : 0
      },
      
      // Important Dates
      dates: {
        orderDate: order.createdAt,
        pickupDate: order.pickupDate,
        deliveryDate: order.deliveryDate,
        lastUpdated: order.updatedAt
      },
      
      // Progress Information
      progress: {
        currentStatus: order.status,
        percentage: progressPercentage,
        isOverdue: order.deliveryDate && order.deliveryDate < new Date() && 
          !['DELIVERED', 'COMPLETED', 'CANCELED'].includes(order.status),
        estimatedCompletion: order.deliveryDate
      },
      
      // Status Timeline
      timeline: statusTimeline,
      
      // Order Notes
      notes: order.notes,
      
      // Review Information
      review: order.reviews[0] || null,
      
      // Activity History
      activityHistory: order.activities.map(activity => ({
        id: activity.id,
        type: activity.type,
        title: activity.title,
        description: activity.description,
        metadata: activity.metadata,
        timestamp: activity.createdAt
      }))
    }

    return successResponse(orderDetails, 'Order details retrieved successfully')
  } catch (error) {
    console.error('Get order details error:', error)
    return errorResponse('Failed to retrieve order details', 500)
  }
}

// PATCH /api/admin/orders/[orderId] - Update order status
export async function PATCH(
  request: NextRequest,
  { params }: { params: { orderId: string } }
) {
  try {
    const { orderId } = params
    const { searchParams } = new URL(request.url)
    const laundryId = searchParams.get('laundryId')
    
    if (!laundryId) {
      return errorResponse('laundryId parameter is required', 400)
    }

    const body = await request.json()
    const { status, notes } = body

    if (!status) {
      return errorResponse('Status is required', 400)
    }

    // Validate status
    const validStatuses = [
      'PENDING', 'CONFIRMED', 'IN_PROGRESS', 'READY_FOR_PICKUP', 
      'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED', 'CANCELED'
    ]

    if (!validStatuses.includes(status)) {
      return errorResponse('Invalid status', 400)
    }

    // Check if order exists and belongs to this laundry
    const existingOrder = await prisma.order.findFirst({
      where: { 
        id: orderId,
        laundryId 
      }
    })

    if (!existingOrder) {
      return errorResponse('Order not found or does not belong to this laundry', 404)
    }

    // Update order
    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        status,
        notes: notes || existingOrder.notes,
        updatedAt: new Date()
      }
    })

     // Map status to ActivityType
    const getActivityType = (orderStatus: string): string => {
      switch (orderStatus) {
        case 'PENDING':
          return 'ORDER_CREATED'
        case 'CONFIRMED':
          return 'ORDER_UPDATED'
        case 'IN_PROGRESS':
          return 'ORDER_UPDATED'
        case 'READY_FOR_PICKUP':
          return 'ORDER_UPDATED'
        case 'OUT_FOR_DELIVERY':
          return 'ORDER_UPDATED'
        case 'DELIVERED':
          return 'ORDER_COMPLETED'
        case 'COMPLETED':
          return 'ORDER_COMPLETED'
        case 'CANCELED':
          return 'ORDER_CANCELED'
        default:
          return 'ORDER_UPDATED'
      }
    }

    // Create activity record for status change
    await prisma.activity.create({
      data: {
        type: getActivityType(status) as any,
        title: `Order ${status.toLowerCase().replace('_', ' ')}`,
        description: `Order status changed to ${status}`,
        laundryId,
        orderId,
        metadata: {
          previousStatus: existingOrder.status,
          newStatus: status,
          updatedBy: 'admin'
        }
      }
    })

    return successResponse(
      { 
        orderId: updatedOrder.id, 
        status: updatedOrder.status,
        updatedAt: updatedOrder.updatedAt 
      }, 
      'Order status updated successfully'
    )
  } catch (error) {
    console.error('Update order status error:', error)
    return errorResponse('Failed to update order status', 500)
  }
}
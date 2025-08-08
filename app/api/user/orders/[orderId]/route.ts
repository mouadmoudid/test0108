// app/api/user/orders/[orderId]/route.ts
import { prisma } from '@/lib/prisma'
import { successResponse, errorResponse } from '@/lib/response'
import { NextRequest } from 'next/server'

// GET /api/user/orders/[orderId]?userId=xxx
export async function GET(
  request: NextRequest,
  { params }: { params: { orderId: string } }
) {
  try {
    const { orderId } = params
    
    // 🔧 FIX: Récupérer userId depuis les paramètres URL au lieu des headers
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')

    if (!userId) {
      return errorResponse('userId parameter is required', 400)
    }

    const order = await prisma.order.findFirst({
      where: { 
        id: orderId,
        customerId: userId 
      },
      include: {
        laundry: {
          select: {
            id: true,
            name: true,
            logo: true,
            phone: true,
            email: true,
            rating: true,
            addresses: {
              select: {
                street: true,
                city: true,
                state: true,
                zipCode: true
              },
              take: 1
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
          select: {
            id: true,
            quantity: true,
            price: true,
            totalPrice: true,
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
            createdAt: true
          },
          where: {
            type: { in: ['ORDER_CREATED', 'ORDER_COMPLETED', 'ORDER_CANCELED', 'ORDER_UPDATED'] }
          },
          orderBy: { createdAt: 'asc' }
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
      return errorResponse('Order not found or does not belong to customer', 404)
    }

    // Build delivery pipeline status
    const statusOrder = ['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED']
    const currentStatusIndex = statusOrder.indexOf(order.status)
    
    const deliveryPipeline = statusOrder.map((status, index) => ({
      status,
      label: status.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase()),
      completed: index <= currentStatusIndex,
      current: index === currentStatusIndex,
      timestamp: order.activities.find(activity => 
        activity.type === `ORDER_${status}`)?.createdAt || null
    }))

    // Format order details
    const orderDetails = {
      // Basic Order Information
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      
      // Delivery Pipeline
      deliveryPipeline,
      currentStatus: {
        status: order.status,
        label: order.status.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase()),
        description: getStatusDescription(order.status)
      },
      
      // Order Summary
      summary: {
        totalAmount: order.totalAmount,
        deliveryFee: order.deliveryFee,
        discount: order.discount,
        finalAmount: order.finalAmount,
        itemCount: order.orderItems.length,
        totalQuantity: order.orderItems.reduce((sum, item) => sum + item.quantity, 0)
      },
      
      // Order Items
      items: order.orderItems.map(item => ({
        id: item.id,
        product: item.product,
        quantity: item.quantity,
        unitPrice: item.price,
        totalPrice: item.totalPrice
      })),
      
      // Laundry Information
      laundry: {
        ...order.laundry,
        location: order.laundry.addresses[0] ? {
          street: order.laundry.addresses[0].street,
          city: order.laundry.addresses[0].city,
          state: order.laundry.addresses[0].state,
          zipCode: order.laundry.addresses[0].zipCode
        } : null
      },
      
      // Delivery Information
      deliveryAddress: order.address,
      
      // Important Dates
      dates: {
        orderDate: order.createdAt,
        pickupDate: order.pickupDate,
        deliveryDate: order.deliveryDate,
        lastUpdated: order.updatedAt
      },
      
      // Order Notes
      notes: order.notes,
      
      // Review Information
      review: order.reviews[0] || null,
      canReview: ['DELIVERED', 'COMPLETED'].includes(order.status) && !order.reviews[0],
      canReorder: ['DELIVERED', 'COMPLETED'].includes(order.status)
    }

    return successResponse(orderDetails, 'Order details retrieved successfully')
  } catch (error) {
    console.error('Get order details error:', error)
    return errorResponse('Failed to retrieve order details', 500)
  }
}

// Helper function to get status descriptions
type OrderStatus = 'PENDING' | 'CONFIRMED' | 'IN_PROGRESS' | 'READY_FOR_PICKUP' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'COMPLETED' | 'CANCELED' | 'REFUNDED';

function getStatusDescription(status: OrderStatus): string {
  const descriptions: Record<OrderStatus, string> = {
    'PENDING': 'Your order has been received and is waiting for confirmation',
    'CONFIRMED': 'Your order has been confirmed and is being prepared',
    'IN_PROGRESS': 'Your laundry is currently being processed',
    'READY_FOR_PICKUP': 'Your laundry is ready and waiting for pickup',
    'OUT_FOR_DELIVERY': 'Your order is on the way to your delivery address',
    'DELIVERED': 'Your order has been delivered successfully',
    'COMPLETED': 'Order completed',
    'CANCELED': 'This order has been canceled',
    'REFUNDED': 'This order has been refunded'
  }
  
  return descriptions[status] || 'Status updated'
}
// app/api/user/orders/[orderId]/reorder/route.ts
import { prisma } from '@/lib/prisma'
import { successResponse, errorResponse } from '@/lib/response'
import { NextRequest } from 'next/server'

// POST /api/user/orders/[orderId]/reorder?userId=xxx
export async function POST(
  request: NextRequest,
  { params }: { params: { orderId: string } }
) {
  try {
    const { orderId } = params
    
    // 🔧 FIX: Récupérer userId depuis les paramètres URL
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')

    if (!userId) {
      return errorResponse('userId parameter is required', 400)
    }

    // Get original order
    const originalOrder = await prisma.order.findFirst({
      where: { 
        id: orderId,
        customerId: userId,
        status: { in: ['DELIVERED', 'COMPLETED'] } // Only allow reorder for completed orders
      },
      include: {
        orderItems: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                price: true,
                isActive: true
              }
            }
          }
        },
        laundry: {
          select: {
            id: true,
            status: true
          }
        },
        address: {
          select: {
            id: true,
            userId: true
          }
        }
      }
    })

    if (!originalOrder) {
      return errorResponse('Original order not found, does not belong to customer, or not eligible for reorder', 404)
    }

    // Check if laundry is still active
    if (originalOrder.laundry.status !== 'ACTIVE') {
      return errorResponse('Laundry is no longer active', 400)
    }

    // Check if address still belongs to user
    if (originalOrder.address.userId !== userId) {
      return errorResponse('Original delivery address is no longer available', 400)
    }

    // Filter out inactive products
    const availableItems = originalOrder.orderItems.filter(item => 
      item.product.isActive !== false // Assuming products have isActive field
    )

    if (availableItems.length === 0) {
      return errorResponse('None of the products from the original order are currently available', 400)
    }

    // Calculate new order totals (prices might have changed)
    let totalAmount = 0
    const newOrderItems = availableItems.map(item => {
      const totalPrice = item.product.price * item.quantity
      totalAmount += totalPrice
      
      return {
        productId: item.productId,
        quantity: item.quantity,
        price: item.product.price, // Use current price
        totalPrice
      }
    })

    const deliveryFee = 15.00 // Use current delivery fee
    const discount = 0 // TODO: Apply any applicable discounts
    const finalAmount = totalAmount + deliveryFee - discount

    // Generate new order number
    const orderNumber = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`

    // Create new order in a transaction
    const newOrder = await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          orderNumber,
          customerId: userId,
          laundryId: originalOrder.laundryId,
          addressId: originalOrder.addressId,
          totalAmount,
          deliveryFee,
          discount,
          finalAmount,
          status: 'PENDING',
          notes: `Reorder of ${originalOrder.orderNumber}`
        }
      })

      // Create order items
      await tx.orderItem.createMany({
        data: newOrderItems.map(item => ({
          ...item,
          orderId: order.id
        }))
      })

      // Create activity log
      await tx.activity.create({
        data: {
          type: 'ORDER_CREATED',
          title: 'Order Created (Reorder)',
          description: `Reorder created from order ${originalOrder.orderNumber}`,
          orderId: order.id,
          laundryId: originalOrder.laundryId,
          userId
        }
      })

      return order
    })

    // Return new order details
    const orderWithDetails = await prisma.order.findUnique({
      where: { id: newOrder.id },
      include: {
        orderItems: {
          include: {
            product: {
              select: {
                name: true,
                category: true,
                unit: true
              }
            }
          }
        },
        laundry: {
          select: {
            name: true,
            logo: true
          }
        }
      }
    })

    return successResponse({
      ...orderWithDetails,
      unavailableItems: originalOrder.orderItems.length - availableItems.length
    }, 'Order reordered successfully')
  } catch (error) {
    console.error('Reorder error:', error)
    return errorResponse('Failed to reorder', 500)
  }
}
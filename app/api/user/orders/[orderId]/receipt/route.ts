// app/api/user/orders/[orderId]/receipt/route.ts
import { prisma } from '@/lib/prisma'
import { errorResponse } from '@/lib/response'
import { NextRequest, NextResponse } from 'next/server'

// GET /api/user/orders/[orderId]/receipt?userId=xxx
export async function GET(
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

    const order = await prisma.order.findFirst({
      where: { 
        id: orderId,
        customerId: userId,
        status: { in: ['DELIVERED', 'COMPLETED'] } // Only allow receipt for completed orders
      },
      include: {
        customer: {
          select: {
            name: true,
            email: true,
            phone: true
          }
        },
        laundry: {
          select: {
            name: true,
            email: true,
            phone: true,
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
            street: true,
            city: true,
            state: true,
            zipCode: true
          }
        },
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
        }
      }
    })

    if (!order) {
      return errorResponse('Order not found, does not belong to customer, or not eligible for receipt', 404)
    }

    // Generate receipt data
    const receipt = {
      receiptNumber: `RCP-${order.orderNumber}`,
      orderNumber: order.orderNumber,
      orderDate: order.createdAt,
      deliveryDate: order.deliveryDate,
      
      // Customer Information
      customer: order.customer,
      
      // Laundry Information
      laundry: {
        name: order.laundry.name,
        email: order.laundry.email,
        phone: order.laundry.phone,
        address: order.laundry.addresses[0]
      },
      
      // Delivery Address
      deliveryAddress: order.address,
      
      // Order Items
      items: order.orderItems.map(item => ({
        name: item.product.name,
        category: item.product.category,
        quantity: item.quantity,
        unit: item.product.unit,
        unitPrice: item.price,
        totalPrice: item.totalPrice
      })),
      
      // Pricing
      pricing: {
        subtotal: order.totalAmount,
        deliveryFee: order.deliveryFee,
        discount: order.discount,
        total: order.finalAmount
      },
      
      // Additional Info
      paymentMethod: 'Cash on Delivery', // TODO: Add payment method to order model
      notes: order.notes,
      generatedAt: new Date()
    }

    return NextResponse.json({
      success: true,
      message: 'Receipt retrieved successfully',
      data: receipt
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="receipt-${order.orderNumber}.json"`
      }
    })
  } catch (error) {
    console.error('Get receipt error:', error)
    return errorResponse('Failed to retrieve receipt', 500)
  }
}
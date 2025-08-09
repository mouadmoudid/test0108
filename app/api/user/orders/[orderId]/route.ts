// app/api/user/orders/[orderId]/route.ts - CUSTOMER uniquement
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOrderAccess, successResponse, errorResponse } from '@/lib/auth-middleware'

export async function GET(
  request: NextRequest,
  { params }: { params: { orderId: string } }
) {
  const authResult = await requireOrderAccess(request, params.orderId)
  
  if (authResult instanceof NextResponse) {
    return authResult
  }

  try {
    const order = await prisma.order.findUnique({
      where: { id: params.orderId },
      include: {
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
        address: {
          select: {
            street: true,
            city: true,
            state: true,
            zipCode: true,
            country: true
          }
        },
        laundry: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true
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
          orderBy: {
            createdAt: 'desc'
          },
          take: 10
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
      return errorResponse('Order not found', 404)
    }

    // Calculer le statut de livraison
    const deliveryStatus = {
      canTrack: ['CONFIRMED', 'IN_PROGRESS', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY'].includes(order.status),
      estimatedDelivery: order.deliveryDate,
      isCompleted: ['DELIVERED', 'COMPLETED'].includes(order.status),
      isCancelled: order.status === 'CANCELED',
      canReview: ['DELIVERED', 'COMPLETED'].includes(order.status) && !order.reviews.length,
      canReorder: ['DELIVERED', 'COMPLETED'].includes(order.status)
    }

    // Calculer les totaux
    const summary = {
      totalItems: order.orderItems.length,
      totalQuantity: order.orderItems.reduce((sum, item) => sum + item.quantity, 0),
      subtotal: order.totalAmount,
      deliveryFee: order.deliveryFee || 0,
      discount: order.discount || 0,
      finalAmount: order.finalAmount
    }

    const orderDetails = {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      
      // Informations de base
      dates: {
        orderDate: order.createdAt,
        pickupDate: order.pickupDate,
        deliveryDate: order.deliveryDate,
        lastUpdated: order.updatedAt
      },
      
      // Laundry info
      laundry: order.laundry,
      
      // Adresse de livraison
      deliveryAddress: order.address,
      
      // Articles commandés
      items: order.orderItems.map(item => ({
        id: item.id,
        product: item.product,
        quantity: item.quantity,
        unitPrice: item.price,
        totalPrice: item.totalPrice
      })),
      
      // Résumé financier
      summary,
      
      // Statut de livraison
      delivery: deliveryStatus,
      
      // Historique des activités
      timeline: order.activities,
      
      // Notes
      notes: order.notes,
      
      // Avis
      review: order.reviews[0] || null
    }

    return successResponse(orderDetails, 'Order details retrieved successfully')
  } catch (error) {
    console.error('Get order details error:', error)
    return errorResponse('Failed to retrieve order details', 500)
  }
}

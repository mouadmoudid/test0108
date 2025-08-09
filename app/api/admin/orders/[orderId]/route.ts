// app/api/admin/orders/[orderId]/route.ts - ADMIN uniquement
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOrderAccess, successResponse, errorResponse } from '@/lib/auth-middleware'
import { z } from 'zod'

const updateOrderSchema = z.object({
  status: z.enum(['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED', 'CANCELED']).optional(),
  pickupDate: z.string().datetime().optional(),
  deliveryDate: z.string().datetime().optional(),
  notes: z.string().max(1000).optional()
})

// GET /api/admin/orders/[orderId] - ADMIN uniquement
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
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            avatar: true
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
                unit: true,
                price: true,
                // estimatedDuration: true,
                // specialInstructions: true
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
            country: true,
            latitude: true,
            longitude: true
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
            createdAt: true,
            user: {
              select: {
                name: true,
                role: true
              }
            }
          },
          orderBy: {
            createdAt: 'desc'
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
      }
    })

    if (!order) {
      return errorResponse('Order not found', 404)
    }

    // // Calculer la durée estimée totale
    // const estimatedDuration = order.orderItems.reduce((total, item) => {
    //   const duration = item.product.estimatedDuration || 24 // 24h par défaut
    //   return total + (duration * item.quantity)
    // }, 0)

    // Calculer les statuts et délais
    const now = new Date()
    const isOverdue = order.deliveryDate && order.deliveryDate < now && 
      !['DELIVERED', 'COMPLETED', 'CANCELED'].includes(order.status)
    
    const hoursUntilDelivery = order.deliveryDate 
      ? Math.ceil((order.deliveryDate.getTime() - now.getTime()) / (1000 * 60 * 60))
      : null

    const orderDetails = {
      // Informations de base
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      
      // Client
      customer: order.customer,
      
      // Adresse de livraison
      deliveryAddress: order.address,
      
      // // Articles commandés avec instructions spéciales
      // items: order.orderItems.map(item => ({
      //   id: item.id,
      //   product: item.product,
      //   quantity: item.quantity,
      //   unitPrice: item.price,
      //   totalPrice: item.totalPrice,
      //   hasSpecialInstructions: !!item.product.specialInstructions
      // })),
      
      // Résumé financier
      pricing: {
        subtotal: order.totalAmount,
        deliveryFee: order.deliveryFee || 0,
        discount: order.discount || 0,
        finalAmount: order.finalAmount
      },
      
      // Dates importantes
      timeline: {
        orderDate: order.createdAt,
        pickupDate: order.pickupDate,
        deliveryDate: order.deliveryDate,
        lastUpdated: order.updatedAt,
        // estimatedDuration: `${estimatedDuration}h`,
        isOverdue,
        hoursUntilDelivery
      },
      
      // Historique des activités
      activityHistory: order.activities,
      
      // Notes et instructions
      notes: order.notes,
      
      // Avis client
      customerReview: order.reviews[0] || null,
      
      // Actions possibles
      actions: {
        canConfirm: order.status === 'PENDING',
        canStartProgress: order.status === 'CONFIRMED',
        canMarkReady: order.status === 'IN_PROGRESS',
        canDispatch: order.status === 'READY_FOR_PICKUP',
        canDeliver: order.status === 'OUT_FOR_DELIVERY',
        canComplete: order.status === 'DELIVERED',
        canCancel: !['DELIVERED', 'COMPLETED', 'CANCELED'].includes(order.status),
        needsAttention: isOverdue
      }
    }

    return successResponse(orderDetails, 'Order details retrieved successfully')
  } catch (error) {
    console.error('Get order details error:', error)
    return errorResponse('Failed to retrieve order details', 500)
  }
}

// PATCH /api/admin/orders/[orderId] - ADMIN uniquement
export async function PATCH(
  request: NextRequest,
  { params }: { params: { orderId: string } }
) {
  const authResult = await requireOrderAccess(request, params.orderId)
  
  if (authResult instanceof NextResponse) {
    return authResult
  }

  const { user } = authResult

  try {
    const body = await request.json()
    
    const parsed = updateOrderSchema.safeParse(body)
    if (!parsed.success) {
      return errorResponse('Validation error', 400)
    }

    const updateData = parsed.data

    // Récupérer l'ordre actuel
    const currentOrder = await prisma.order.findUnique({
      where: { id: params.orderId },
      select: { status: true, orderNumber: true }
    })

    if (!currentOrder) {
      return errorResponse('Order not found', 404)
    }

    // Valider les transitions de statut
    const validTransitions: Record<string, string[]> = {
      'PENDING': ['CONFIRMED', 'CANCELED'],
      'CONFIRMED': ['IN_PROGRESS', 'CANCELED'],
      'IN_PROGRESS': ['READY_FOR_PICKUP', 'CANCELED'],
      'READY_FOR_PICKUP': ['OUT_FOR_DELIVERY', 'CANCELED'],
      'OUT_FOR_DELIVERY': ['DELIVERED', 'CANCELED'],
      'DELIVERED': ['COMPLETED'],
      'COMPLETED': [],
      'CANCELED': []
    }

    if (updateData.status && updateData.status !== currentOrder.status) {
      const allowedStatuses = validTransitions[currentOrder.status] || []
      if (!allowedStatuses.includes(updateData.status)) {
        return errorResponse(
          `Invalid status transition from ${currentOrder.status} to ${updateData.status}`,
          400
        )
      }
    }

    // Convertir les dates string en Date objects
    const finalUpdateData: any = { ...updateData }
    if (updateData.pickupDate) {
      finalUpdateData.pickupDate = new Date(updateData.pickupDate)
    }
    if (updateData.deliveryDate) {
      finalUpdateData.deliveryDate = new Date(updateData.deliveryDate)
    }

    // Mettre à jour la commande
    const updatedOrder = await prisma.order.update({
      where: { id: params.orderId },
      data: finalUpdateData,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        pickupDate: true,
        deliveryDate: true,
        notes: true,
        updatedAt: true
      }
    })

    // Créer une activité pour le changement de statut
    if (updateData.status && updateData.status !== currentOrder.status) {
      await prisma.activity.create({
        data: {
          type: 'ORDER_UPDATED',
          title: `Statut mis à jour: ${updateData.status}`,
          description: `Commande ${currentOrder.orderNumber} passée de ${currentOrder.status} à ${updateData.status}`,
          orderId: params.orderId,
          userId: user.sub,
          metadata: {
            previousStatus: currentOrder.status,
            newStatus: updateData.status,
            updatedBy: user.name
          }
        }
      })
    }

    return successResponse(updatedOrder, 'Order updated successfully')
  } catch (error) {
    console.error('Update order error:', error)
    return errorResponse('Failed to update order', 500)
  }
}
// app/api/user/orders/[orderId]/reorder/route.ts - CUSTOMER uniquement
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOrderAccess, successResponse, errorResponse } from '@/lib/auth-middleware'

export async function POST(
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
    const { addressId, pickupDate, deliveryDate, notes } = body

    // Récupérer la commande originale
    const originalOrder = await prisma.order.findUnique({
      where: { 
        id: params.orderId,
        status: { in: ['DELIVERED', 'COMPLETED'] } // Peut seulement re-commander des commandes terminées
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
        }
      }
    })

    if (!originalOrder) {
      return errorResponse('Original order not found or cannot be reordered', 404)
    }

    // Vérifier que l'adresse appartient au client
    const address = await prisma.address.findUnique({
      where: {
        id: addressId,
        userId: user.sub
      }
    })

    if (!address) {
      return errorResponse('Invalid delivery address', 400)
    }

    // Filtrer les produits toujours actifs
    const activeItems = originalOrder.orderItems.filter(item => item.product.isActive)
    
    if (activeItems.length === 0) {
      return errorResponse('No active products available for reorder', 400)
    }

    // Générer un nouveau numéro de commande
    const orderCount = await prisma.order.count()
    const orderNumber = `ORD-${String(orderCount + 1).padStart(6, '0')}`

    // Calculer les totaux
    const totalAmount = activeItems.reduce((sum, item) => sum + (item.product.price * item.quantity), 0)
    const deliveryFee = 20 // À adapter selon votre logique
    const finalAmount = totalAmount + deliveryFee

    // Créer la nouvelle commande
    const newOrder = await prisma.order.create({
      data: {
        orderNumber,
        customerId: user.sub,
        laundryId: originalOrder.laundryId,
        addressId,
        status: 'PENDING',
        totalAmount,
        deliveryFee,
        finalAmount,
        pickupDate: pickupDate ? new Date(pickupDate) : null,
        deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
        notes: notes || `Reorder from ${originalOrder.orderNumber}`,
        orderItems: {
          create: activeItems.map(item => ({
            productId: item.productId,
            quantity: item.quantity,
            price: item.product.price, // Utiliser le prix actuel
            totalPrice: item.product.price * item.quantity
          }))
        }
      },
      include: {
        orderItems: {
          include: {
            product: {
              select: {
                name: true,
                category: true
              }
            }
          }
        }
      }
    })

    // Créer une activité
    await prisma.activity.create({
      data: {
        type: 'ORDER_CREATED',
        title: 'Nouvelle commande créée (Re-commande)',
        description: `Commande ${newOrder.orderNumber} créée à partir de ${originalOrder.orderNumber}`,
        orderId: newOrder.id,
        userId: user.sub
      }
    })

    return successResponse({
      orderId: newOrder.id,
      orderNumber: newOrder.orderNumber,
      totalItems: activeItems.length,
      finalAmount: newOrder.finalAmount,
      unavailableItems: originalOrder.orderItems.length - activeItems.length
    }, 'Order reordered successfully')
  } catch (error) {
    console.error('Reorder error:', error)
    return errorResponse('Failed to reorder', 500)
  }
}
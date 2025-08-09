// app/api/user/orders/active/route.ts - CUSTOMER uniquement (CORRIGÉ)
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole, successResponse, errorResponse } from '@/lib/auth-middleware'
import { OrderStatus } from '@prisma/client'

export async function GET(request: NextRequest) {
  const authResult = await requireRole(request, ['CUSTOMER'])
  
  if (authResult instanceof NextResponse) {
    return authResult
  }

  const { user } = authResult

  try {
    // CORRECTION: Utiliser les types OrderStatus de Prisma au lieu de strings
    const activeStatuses: OrderStatus[] = [
      'PENDING', 
      'CONFIRMED', 
      'IN_PROGRESS', 
      'READY_FOR_PICKUP', 
      'OUT_FOR_DELIVERY'
    ]
    
    const activeOrders = await prisma.order.findMany({
      where: {
        customerId: user.sub,
        status: {
          in: activeStatuses // CORRIGÉ: Types appropriés
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
        },
        laundry: {
          select: {
            name: true,
            phone: true
          }
        },
        address: {
          select: {
            street: true,
            city: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    })

    const formattedOrders = activeOrders.map(order => {
      const primaryService = order.orderItems[0]?.product?.category || 'Service général'
      const totalItems = order.orderItems.reduce((sum: number, item: any) => sum + item.quantity, 0)
      
      // Calculer le temps estimé restant
      const now = new Date()
      const estimatedDelivery = order.deliveryDate
      const hoursRemaining = estimatedDelivery 
        ? Math.max(0, Math.ceil((estimatedDelivery.getTime() - now.getTime()) / (1000 * 60 * 60)))
        : null

      return {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        primaryService,
        totalItems,
        finalAmount: order.finalAmount,
        
        laundry: {
          name: order.laundry?.name || 'Laundry inconnue',
          phone: order.laundry?.phone || null
        },
        
        deliveryAddress: {
          street: order.address?.street || 'Adresse inconnue',
          city: order.address?.city || 'Ville inconnue'
        },
        
        dates: {
          orderDate: order.createdAt,
          estimatedDelivery: order.deliveryDate,
          hoursRemaining
        },
        
        progress: {
          canTrack: ['CONFIRMED', 'IN_PROGRESS', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY'].includes(order.status),
          currentStep: order.status,
          isUrgent: hoursRemaining !== null && hoursRemaining <= 24
        }
      }
    })

    return successResponse({
      orders: formattedOrders,
      count: formattedOrders.length,
      hasActiveOrders: formattedOrders.length > 0
    }, 'Active orders retrieved successfully')
  } catch (error) {
    console.error('Get active orders error:', error)
    return errorResponse('Failed to retrieve active orders', 500)
  }
}
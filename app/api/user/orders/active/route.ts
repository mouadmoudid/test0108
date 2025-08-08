// app/api/user/orders/active/route.ts - CUSTOMER uniquement
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-middleware'

export async function GET(request: NextRequest) {
  // Vérifier que l'utilisateur est CUSTOMER UNIQUEMENT
  const authResult = await requireRole(request, ['CUSTOMER'])
  
  if (authResult instanceof NextResponse) {
    return authResult // Erreur d'authentification ou d'autorisation
  }

  const { user } = authResult

  // Vérifier que user.sub existe
  if (!user.sub) {
    return NextResponse.json(
      { success: false, message: 'Invalid user session' },
      { status: 401 }
    )
  }

  try {
    // Récupérer les commandes actives du customer
    const activeOrders = await prisma.order.findMany({
      where: { 
        customerId: user.sub,
        status: {
          in: ['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY']
        }
      },
      include: {
        laundry: {
          select: {
            id: true,
            name: true,
            phone: true,
            logo: true,
            addresses: {
              select: {
                street: true,
                city: true,
                state: true
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
          select: {
            id: true,
            quantity: true,
            price: true,
            totalPrice: true,
            product: {
              select: {
                name: true,
                category: true,
                unit: true
              }
            }
          }
        },
        _count: {
          select: {
            orderItems: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    // Formater les résultats
    const formattedOrders = activeOrders.map(order => ({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      placedDate: order.createdAt,
      estimatedDelivery: order.deliveryDate,
      
      // Order summary
      summary: {
        itemCount: order._count.orderItems,
        totalItems: order.orderItems.reduce((sum, item) => sum + item.quantity, 0),
        totalCost: order.finalAmount,
        deliveryFee: order.deliveryFee
      },
      
      // Laundry info
      laundry: {
        id: order.laundry.id,
        name: order.laundry.name,
        phone: order.laundry.phone,
        logo: order.laundry.logo,
        address: order.laundry.addresses[0] || null
      },
      
      // Delivery address
      deliveryAddress: order.address,
      
      // Items summary for quick view
      items: order.orderItems.map(item => ({
        name: item.product.name,
        category: item.product.category,
        quantity: item.quantity,
        unit: item.product.unit
      })),
      
      // Progress indicators
      progress: {
        current: order.status,
        canTrack: true,
        canCancel: ['PENDING', 'CONFIRMED'].includes(order.status),
        estimatedTimeRemaining: getEstimatedTimeRemaining(order.status, order.createdAt)
      },
      
      // Dates
      dates: {
        placed: order.createdAt,
        pickup: order.pickupDate,
        delivery: order.deliveryDate,
        lastUpdated: order.updatedAt
      }
    }))

    return NextResponse.json({
      success: true,
      message: 'Active orders retrieved successfully',
      data: {
        orders: formattedOrders,
        summary: {
          totalActiveOrders: formattedOrders.length,
          totalValue: formattedOrders.reduce((sum, order) => sum + order.summary.totalCost, 0),
          statusBreakdown: getStatusBreakdown(formattedOrders)
        }
      },
      requestedBy: {
        userId: user.sub,
        role: user.role
      }
    })

  } catch (error) {
    console.error('Get active orders error:', error)
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Helper function to estimate remaining time
function getEstimatedTimeRemaining(status: string, createdAt: Date): string {
  const now = new Date()
  const hoursElapsed = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60))
  
  switch (status) {
    case 'PENDING':
      return '2-4 hours (confirmation pending)'
    case 'CONFIRMED':
      return '4-8 hours (pickup scheduled)'
    case 'IN_PROGRESS':
      return '12-24 hours (processing)'
    case 'READY_FOR_PICKUP':
      return '2-4 hours (ready for pickup)'
    case 'OUT_FOR_DELIVERY':
      return '1-3 hours (out for delivery)'
    default:
      return 'Updating...'
  }
}

// Helper function for status breakdown
function getStatusBreakdown(orders: any[]): Record<string, number> {
  return orders.reduce((breakdown, order) => {
    const status = order.status
    breakdown[status] = (breakdown[status] || 0) + 1
    return breakdown
  }, {} as Record<string, number>)
}
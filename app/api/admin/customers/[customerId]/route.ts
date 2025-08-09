// app/api/admin/customers/[customerId]/route.ts - ADMIN uniquement
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole, successResponse, errorResponse } from '@/lib/auth-middleware'

// GET /api/admin/customers/[customerId] - ADMIN uniquement
export async function GET(
  request: NextRequest,
  { params }: { params: { customerId: string } }
) {
  const authResult = await requireRole(request, ['ADMIN'], { requireLaundry: true })
  
  if (authResult instanceof NextResponse) {
    return authResult
  }

  const { user } = authResult

  try {
    // Récupérer le client avec vérification qu'il appartient à la laundry de l'admin
    const customer = await prisma.user.findFirst({
      where: {
        id: params.customerId,
        role: 'CUSTOMER',
        orders: {
          some: {
            laundryId: user.laundryId
          }
        }
      },
      include: {
        addresses: {
          select: {
            id: true,
            street: true,
            city: true,
            state: true,
            zipCode: true,
            isDefault: true,
            createdAt: true
          },
          orderBy: {
            isDefault: 'desc'
          }
        },
        orders: {
          where: {
            laundryId: user.laundryId
          },
          select: {
            id: true,
            orderNumber: true,
            status: true,
            totalAmount: true,
            finalAmount: true,
            createdAt: true,
            deliveryDate: true
          },
          orderBy: {
            createdAt: 'desc'
          },
          take: 10 // Les 10 dernières commandes
        },
        reviews: {
          where: {
            order: {
              laundryId: user.laundryId
            }
          },
          select: {
            id: true,
            rating: true,
            comment: true,
            createdAt: true,
            order: {
              select: {
                orderNumber: true
              }
            }
          },
          orderBy: {
            createdAt: 'desc'
          },
          take: 5
        }
      }
    })

    if (!customer) {
      return errorResponse('Customer not found or not associated with your laundry', 404)
    }

    // Calculer les statistiques du client
    const stats = await prisma.order.aggregate({
      where: {
        customerId: params.customerId,
        laundryId: user.laundryId,
        status: { in: ['DELIVERED', 'COMPLETED'] }
      },
      _count: { id: true },
      _sum: { finalAmount: true },
      _avg: { finalAmount: true }
    })

    // Calculer la fréquence des commandes
    const firstOrder = await prisma.order.findFirst({
      where: {
        customerId: params.customerId,
        laundryId: user.laundryId
      },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true }
    })

    const lastOrder = await prisma.order.findFirst({
      where: {
        customerId: params.customerId,
        laundryId: user.laundryId
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true }
    })

    // Calculer la fréquence (commandes par mois)
    let orderFrequency = 0
    if (firstOrder && lastOrder && stats._count.id > 1) {
      const daysBetween = (lastOrder.createdAt.getTime() - firstOrder.createdAt.getTime()) / (1000 * 60 * 60 * 24)
      const monthsBetween = daysBetween / 30
      orderFrequency = monthsBetween > 0 ? Number((stats._count.id / monthsBetween).toFixed(1)) : 0
    }

    // Services préférés
    const preferredServices = await prisma.orderItem.groupBy({
      by: ['productId'],
      where: {
        order: {
          customerId: params.customerId,
          laundryId: user.laundryId
        }
      },
      _count: { id: true },
      _sum: { quantity: true },
      orderBy: { _count: { id: 'desc' } },
      take: 3
    })

    const productIds = preferredServices.map(service => service.productId)
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, category: true }
    })

    const formattedPreferredServices = preferredServices.map(service => {
      const product = products.find(p => p.id === service.productId)
      return {
        serviceName: product?.name || 'Service inconnu',
        category: product?.category || 'Catégorie inconnue',
        orderCount: service._count.id,
        totalQuantity: service._sum.quantity
      }
    })

    // Déterminer le segment du client
    const totalSpent = stats._sum.finalAmount || 0
    const orderCount = stats._count.id || 0
    let segment = 'Nouveau'
    
    if (totalSpent > 1000 && orderCount > 10) segment = 'VIP'
    else if (totalSpent > 500 && orderCount > 5) segment = 'Régulier'
    else if (orderCount > 2) segment = 'Fidèle'

    // Calculer les jours depuis la dernière commande
    const daysSinceLastOrder = lastOrder 
      ? Math.floor((new Date().getTime() - lastOrder.createdAt.getTime()) / (1000 * 60 * 60 * 24))
      : null

    const customerProfile = {
      // Informations de base
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      avatar: customer.avatar,
      role: customer.role,
      createdAt: customer.createdAt,
      suspendedAt: customer.suspendedAt,
      suspensionReason: customer.suspensionReason,

      // Statistiques
      statistics: {
        totalOrders: orderCount,
        completedOrders: stats._count.id,
        totalSpent: totalSpent,
        averageOrderValue: stats._avg.finalAmount || 0,
        orderFrequency, // commandes par mois
        daysSinceLastOrder,
        segment
      },

      // Adresses
      addresses: customer.addresses,

      // Commandes récentes
      recentOrders: customer.orders.map(order => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        amount: order.finalAmount,
        orderDate: order.createdAt,
        deliveryDate: order.deliveryDate
      })),

      // Services préférés
      preferredServices: formattedPreferredServices,

      // Avis récents
      recentReviews: customer.reviews.map(review => ({
        id: review.id,
        rating: review.rating,
        comment: review.comment,
        orderNumber: review.order?.orderNumber || 'N/A',
        date: review.createdAt
      })),

      // Insights
      insights: {
        isVipCustomer: segment === 'VIP',
        isAtRisk: daysSinceLastOrder !== null && daysSinceLastOrder > 60,
        needsAttention: customer.suspendedAt !== null,
        loyaltyScore: Math.min(100, Math.round((orderCount * 10) + (totalSpent / 100)))
      }
    }

    return successResponse(customerProfile, 'Customer profile retrieved successfully')
  } catch (error) {
    console.error('Get customer profile error:', error)
    return errorResponse('Failed to retrieve customer profile', 500)
  }
}

// DELETE /api/admin/customers/[customerId] - ADMIN uniquement
export async function DELETE(
  request: NextRequest,
  { params }: { params: { customerId: string } }
) {
  const authResult = await requireRole(request, ['ADMIN'], { requireLaundry: true })
  
  if (authResult instanceof NextResponse) {
    return authResult
  }

  const { user } = authResult

  try {
    // Vérifier que le client existe et appartient à la laundry de l'admin
    const customer = await prisma.user.findFirst({
      where: {
        id: params.customerId,
        role: 'CUSTOMER',
        orders: {
          some: {
            laundryId: user.laundryId
          }
        }
      },
      include: {
        orders: {
          where: {
            laundryId: user.laundryId,
            status: {
              in: ['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY']
            }
          },
          select: { id: true, orderNumber: true, status: true }
        }
      }
    })

    if (!customer) {
      return errorResponse('Customer not found or not associated with your laundry', 404)
    }

    // Vérifier qu'il n'y a pas de commandes actives
    if (customer.orders.length > 0) {
      return errorResponse(
        `Cannot delete customer: ${customer.orders.length} active order(s) found. Please complete or cancel active orders first.`,
        400
      )
    }

    // Suspendre le client au lieu de le supprimer (soft delete)
    const suspendedCustomer = await prisma.user.update({
      where: { id: params.customerId },
      data: {
        suspendedAt: new Date(),
        suspensionReason: `Account suspended by admin from laundry ${user.laundryId}`
      },
      select: {
        id: true,
        name: true,
        email: true,
        suspendedAt: true
      }
    })

    // Créer une activité
    await prisma.activity.create({
      data: {
        type: 'USER_SUSPENDED',
        title: 'Client suspendu',
        description: `Client ${customer.name} (${customer.email}) suspendu par l'admin`,
        userId: user.sub,
        metadata: {
          suspendedUserId: params.customerId,
          reason: 'Admin action'
        }
      }
    })

    return successResponse({
      customerId: suspendedCustomer.id,
      name: suspendedCustomer.name,
      email: suspendedCustomer.email,
      suspendedAt: suspendedCustomer.suspendedAt,
      action: 'suspended'
    }, 'Customer suspended successfully')
  } catch (error) {
    console.error('Suspend customer error:', error)
    return errorResponse('Failed to suspend customer', 500)
  }
}

// PATCH /api/admin/customers/[customerId] - ADMIN uniquement pour réactiver un client
export async function PATCH(
  request: NextRequest,
  { params }: { params: { customerId: string } }
) {
  const authResult = await requireRole(request, ['ADMIN'], { requireLaundry: true })
  
  if (authResult instanceof NextResponse) {
    return authResult
  }

  const { user } = authResult

  try {
    const body = await request.json()
    const { action } = body

    if (action !== 'reactivate') {
      return errorResponse('Only reactivation action is supported', 400)
    }

    // Vérifier que le client existe
    const customer = await prisma.user.findFirst({
      where: {
        id: params.customerId,
        role: 'CUSTOMER',
        suspendedAt: { not: null }
      }
    })

    if (!customer) {
      return errorResponse('Customer not found or not suspended', 404)
    }

    // Réactiver le client
    const reactivatedCustomer = await prisma.user.update({
      where: { id: params.customerId },
      data: {
        suspendedAt: null,
        suspensionReason: null
      },
      select: {
        id: true,
        name: true,
        email: true,
        suspendedAt: true
      }
    })

    // Créer une activité
    await prisma.activity.create({
      data: {
        type: 'USER_REACTIVATED',
        title: 'Client réactivé',
        description: `Client ${customer.name} (${customer.email}) réactivé par l'admin`,
        userId: user.sub,
        metadata: {
          reactivatedUserId: params.customerId
        }
      }
    })

    return successResponse({
      customerId: reactivatedCustomer.id,
      name: reactivatedCustomer.name,
      email: reactivatedCustomer.email,
      suspendedAt: reactivatedCustomer.suspendedAt,
      action: 'reactivated'
    }, 'Customer reactivated successfully')
  } catch (error) {
    console.error('Reactivate customer error:', error)
    return errorResponse('Failed to reactivate customer', 500)
  }
}
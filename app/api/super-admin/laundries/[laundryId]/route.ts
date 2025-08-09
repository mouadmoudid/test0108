// app/api/super-admin/laundries/[laundryId]/route.ts - SUPER_ADMIN uniquement (CORRIGÉ)
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole, successResponse, errorResponse } from '@/lib/auth-middleware'
import { z } from 'zod'

const updateLaundrySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING']).optional(),
  suspensionReason: z.string().optional()
})

// GET /api/super-admin/laundries/[laundryId] - SUPER_ADMIN uniquement
export async function GET(
  request: NextRequest,
  { params }: { params: { laundryId: string } }
) {
  const authResult = await requireRole(request, ['SUPER_ADMIN'])
  
  if (authResult instanceof NextResponse) {
    return authResult
  }

  try {
    const laundry = await prisma.laundry.findUnique({
      where: { id: params.laundryId },
      include: {
        admin: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            avatar: true,
            createdAt: true,
            suspendedAt: true,
            suspensionReason: true
          }
        },
        addresses: {
          select: {
            street: true,
            city: true,
            state: true,
            zipCode: true,
            country: true,
            isDefault: true
          }
        },
        products: {
          select: {
            id: true,
            name: true,
            category: true,
            price: true,
            isActive: true
          },
          where: { isActive: true },
          take: 10
        },
        orders: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
            finalAmount: true,
            createdAt: true,
            customer: {
              select: {
                name: true
              }
            }
          },
          orderBy: { createdAt: 'desc' },
          take: 10
        }
      }
    })

    if (!laundry) {
      return errorResponse('Laundry not found', 404)
    }

    // Calculer les statistiques détaillées
    const [
      totalOrders,
      completedOrders,
      totalRevenue,
      totalCustomers,
      averageRating,
      currentMonthStats
    ] = await Promise.all([
      // Total commandes
      prisma.order.count({
        where: { laundryId: params.laundryId }
      }),
      
      // Commandes terminées
      prisma.order.count({
        where: {
          laundryId: params.laundryId,
          status: { in: ['DELIVERED', 'COMPLETED'] }
        }
      }),
      
      // Revenus totaux
      prisma.order.aggregate({
        where: {
          laundryId: params.laundryId,
          status: { in: ['DELIVERED', 'COMPLETED'] }
        },
        _sum: { finalAmount: true }
      }),
      
      // Total clients
      prisma.user.count({
        where: {
          role: 'CUSTOMER',
          orders: {
            some: { laundryId: params.laundryId }
          }
        }
      }),
      
      // Rating moyen
      prisma.review.aggregate({
        where: {
          order: { laundryId: params.laundryId }
        },
        _avg: { rating: true },
        _count: { id: true }
      }),
      
      // Stats du mois actuel
      prisma.order.aggregate({
        where: {
          laundryId: params.laundryId,
          createdAt: {
            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
          }
        },
        _count: { id: true },
        _sum: { finalAmount: true }
      })
    ])

    // Commandes en retard
    const overdueOrders = await prisma.order.count({
      where: {
        laundryId: params.laundryId,
        status: { in: ['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY'] },
        deliveryDate: { lt: new Date() }
      }
    })

    // Services les plus populaires
    const popularServices = await prisma.orderItem.groupBy({
      by: ['productId'],
      where: {
        order: { laundryId: params.laundryId }
      },
      _count: { id: true },
      _sum: { totalPrice: true },
      orderBy: { _count: { id: 'desc' } },
      take: 5
    })

    const productIds = popularServices.map(service => service.productId)
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, category: true }
    })

    const formattedPopularServices = popularServices.map(service => {
      const product = products.find(p => p.id === service.productId)
      return {
        productName: product?.name || 'Produit inconnu',
        category: product?.category || 'Catégorie inconnue',
        orderCount: service._count.id,
        totalRevenue: service._sum.totalPrice || 0
      }
    })

    // CORRECTION: Gestion des valeurs potentiellement null
    const totalRevenueAmount = totalRevenue._sum.finalAmount || 0
    const averageRatingValue = averageRating._avg.rating || 0
    const currentMonthRevenue = currentMonthStats._sum.finalAmount || 0

    const laundryDetails = {
      // Informations de base
      id: laundry.id,
      name: laundry.name,
      email: laundry.email,
      phone: laundry.phone,
      status: laundry.status,
      createdAt: laundry.createdAt,
      updatedAt: laundry.updatedAt,
      
      // Admin associé
      admin: laundry.admin,
      
      // Adresses
      addresses: laundry.addresses,
      
      // Statistiques globales
      statistics: {
        totalOrders,
        completedOrders,
        completionRate: totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 0,
        totalRevenue: totalRevenueAmount, // CORRIGÉ
        totalCustomers,
        averageRating: Number(averageRatingValue.toFixed(1)), // CORRIGÉ
        totalReviews: averageRating._count.id,
        overdueOrders,
        
        // Stats du mois
        currentMonth: {
          orders: currentMonthStats._count.id,
          revenue: currentMonthRevenue // CORRIGÉ
        }
      },
      
      // Produits actifs
      activeProducts: laundry.products,
      totalActiveProducts: laundry.products.length,
      
      // Services populaires
      popularServices: formattedPopularServices,
      
      // Commandes récentes
      recentOrders: laundry.orders.map(order => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        amount: order.finalAmount,
        customerName: order.customer?.name || 'Client inconnu', // CORRIGÉ
        date: order.createdAt
      })),
      
      // Statut de santé
      healthMetrics: {
        overall: overdueOrders === 0 && completedOrders > 0 ? 'excellent' :
                overdueOrders <= 2 && completedOrders > 0 ? 'good' :
                completedOrders > 0 ? 'warning' : 'poor',
        profitability: totalRevenueAmount > 10000 ? 'high' : // CORRIGÉ
                      totalRevenueAmount > 5000 ? 'medium' : 'low', // CORRIGÉ
        customerSatisfaction: averageRatingValue >= 4.5 ? 'excellent' : // CORRIGÉ
                             averageRatingValue >= 4 ? 'good' : // CORRIGÉ
                             averageRatingValue >= 3 ? 'average' : 'poor', // CORRIGÉ
        operational: overdueOrders === 0 ? 'excellent' : 'needs_attention'
      },
      
      // Flags d'attention
      alerts: {
        hasOverdueOrders: overdueOrders > 0,
        lowRating: averageRatingValue < 3, // CORRIGÉ
        inactiveProducts: laundry.products.length === 0,
        suspendedAdmin: !!laundry.admin?.suspendedAt,
        needsAttention: overdueOrders > 5 || averageRatingValue < 3 // CORRIGÉ
      }
    }

    return successResponse(laundryDetails, 'Laundry details retrieved successfully')
  } catch (error) {
    console.error('Get laundry details error:', error)
    return errorResponse('Failed to retrieve laundry details', 500)
  }
}

// PATCH /api/super-admin/laundries/[laundryId] - SUPER_ADMIN uniquement
export async function PATCH(
  request: NextRequest,
  { params }: { params: { laundryId: string } }
) {
  const authResult = await requireRole(request, ['SUPER_ADMIN'])
  
  if (authResult instanceof NextResponse) {
    return authResult
  }

  const { user } = authResult

  try {
    const body = await request.json()
    
    const parsed = updateLaundrySchema.safeParse(body)
    if (!parsed.success) {
      return errorResponse('Validation error', 400)
    }

    const updateData = parsed.data

    // Vérifier que la laundry existe
    const existingLaundry = await prisma.laundry.findUnique({
      where: { id: params.laundryId },
      select: { id: true, name: true, status: true }
    })

    if (!existingLaundry) {
      return errorResponse('Laundry not found', 404)
    }

    // Mettre à jour la laundry
    const updatedLaundry = await prisma.laundry.update({
      where: { id: params.laundryId },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        updatedAt: true
      }
    })

    // Créer une activité pour le changement de statut
    if (updateData.status && updateData.status !== existingLaundry.status) {
      const activityType = updateData.status === 'SUSPENDED' ? 'LAUNDRY_SUSPENDED' :
                          updateData.status === 'ACTIVE' ? 'LAUNDRY_ACTIVATED' :
                          'LAUNDRY_UPDATED'
      
      await prisma.activity.create({
        data: {
          type: activityType,
          title: `Statut laundry mis à jour: ${updateData.status}`,
          description: `Laundry "${existingLaundry.name}" passée de ${existingLaundry.status} à ${updateData.status}`,
          userId: user.sub,
          metadata: {
            laundryId: params.laundryId,
            laundryName: existingLaundry.name,
            previousStatus: existingLaundry.status,
            newStatus: updateData.status,
            suspensionReason: updateData.suspensionReason,
            updatedBy: user.name
          }
        }
      })
    }

    return successResponse(updatedLaundry, 'Laundry updated successfully')
  } catch (error) {
    console.error('Update laundry error:', error)
    return errorResponse('Failed to update laundry', 500)
  }
}
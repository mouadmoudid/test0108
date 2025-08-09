// app/api/admin/products/[productId]/route.ts - ADMIN uniquement (CORRIGÉ)
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-middleware'
import { z } from 'zod'

// Helpers de réponse
const successResponse = (data: any, message: string = 'Success') => {
  return NextResponse.json({
    success: true,
    message,
    data
  })
}

const errorResponse = (message: string, status: number = 400) => {
  return NextResponse.json(
    { success: false, message },
    { status }
  )
}

const updateProductSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  category: z.string().min(1).optional(),
  price: z.coerce.number().min(0).optional(),
  unit: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  estimatedDuration: z.coerce.number().min(1).optional(),
  specialInstructions: z.string().optional()
})

// GET /api/admin/products/[productId] - ADMIN uniquement
export async function GET(
  request: NextRequest,
  { params }: { params: { productId: string } }
) {
  const authResult = await requireRole(request, ['ADMIN'], { requireLaundry: true })
  
  if (authResult instanceof NextResponse) {
    return authResult
  }

  const { user } = authResult

  try {
    const product = await prisma.product.findFirst({
      where: {
        id: params.productId,
        laundryId: user.laundryId
      },
      include: {
        orderItems: {
          include: {
            order: {
              select: {
                id: true,
                orderNumber: true,
                status: true,
                createdAt: true,
                customerId: true // CORRECTION: utiliser customerId au lieu de customer relation
              }
            }
          },
          orderBy: {
            createdAt: 'desc'
          },
          take: 10 // 10 dernières commandes
        }
      }
    })

    if (!product) {
      return errorResponse('Product not found', 404)
    }

    // Récupérer les noms des clients séparément si nécessaire
    const customerIdsSet = new Set(product.orderItems.map(item => item.order.customerId))
    const customerIds = Array.from(customerIdsSet) // CORRECTION: utiliser Array.from au lieu du spread
    const customers = await prisma.user.findMany({
      where: { id: { in: customerIds } },
      select: { id: true, name: true }
    })

    // Calculer les statistiques détaillées
    const stats = await prisma.orderItem.aggregate({
      where: {
        productId: params.productId,
        order: {
          status: { in: ['DELIVERED', 'COMPLETED'] }
        }
      },
      _sum: { 
        quantity: true,
        totalPrice: true 
      },
      _count: { id: true },
      _avg: { totalPrice: true }
    })

    // Statistiques par mois (6 derniers mois)
    const monthlyStats = await Promise.all(
      Array.from({ length: 6 }, async (_, i) => {
        const endDate = new Date()
        endDate.setMonth(endDate.getMonth() - i)
        const startDate = new Date(endDate.getFullYear(), endDate.getMonth(), 1)
        endDate.setMonth(endDate.getMonth() + 1)
        endDate.setDate(0) // Dernier jour du mois

        const monthStats = await prisma.orderItem.aggregate({
          where: {
            productId: params.productId,
            order: {
              status: { in: ['DELIVERED', 'COMPLETED'] },
              createdAt: {
                gte: startDate,
                lte: endDate
              }
            }
          },
          _sum: { 
            quantity: true,
            totalPrice: true 
          },
          _count: { id: true }
        })

        return {
          month: startDate.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }),
          orders: monthStats._count.id || 0,
          quantity: monthStats._sum.quantity || 0,
          revenue: monthStats._sum.totalPrice || 0
        }
      })
    )

    const productDetails = {
      id: product.id,
      name: product.name,
      description: product.description,
      category: product.category,
      price: product.price,
      unit: product.unit,
      isActive: product.isActive,
      // estimatedDuration: product.estimatedDuration,
      // specialInstructions: product.specialInstructions,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
      laundryId: product.laundryId,
      
      // Statistiques globales
      statistics: {
        totalOrders: stats._count.id || 0,
        totalQuantitySold: stats._sum.quantity || 0,
        totalRevenue: stats._sum.totalPrice || 0,
        averageOrderValue: stats._avg.totalPrice || 0
      },

      // Évolution mensuelle
      monthlyPerformance: monthlyStats.reverse(),

      // Commandes récentes avec noms des clients
      recentOrders: product.orderItems.map(item => {
        const customer = customers.find(c => c.id === item.order.customerId)
        return {
          orderId: item.order.id,
          orderNumber: item.order.orderNumber,
          customerName: customer?.name || 'Client inconnu',
          quantity: item.quantity,
          totalPrice: item.totalPrice,
          status: item.order.status,
          orderDate: item.order.createdAt
        }
      })
    }

    return successResponse(productDetails, 'Product details retrieved successfully')
  } catch (error) {
    console.error('Get product details error:', error)
    return errorResponse('Failed to retrieve product details', 500)
  }
}

// PUT /api/admin/products/[productId] - ADMIN uniquement
export async function PUT(
  request: NextRequest,
  { params }: { params: { productId: string } }
) {
  const authResult = await requireRole(request, ['ADMIN'], { requireLaundry: true })
  
  if (authResult instanceof NextResponse) {
    return authResult
  }

  const { user } = authResult

  try {
    const body = await request.json()
    
    const parsed = updateProductSchema.safeParse(body)
    if (!parsed.success) {
      return errorResponse('Validation error', 400)
    }

    const updateData = parsed.data

    // Vérifier que le produit appartient à la laundry de l'admin
    const existingProduct = await prisma.product.findFirst({
      where: {
        id: params.productId,
        laundryId: user.laundryId
      }
    })

    if (!existingProduct) {
      return errorResponse('Product not found', 404)
    }

    // Si le nom change, vérifier qu'il n'existe pas déjà
    if (updateData.name && updateData.name !== existingProduct.name) {
      const duplicateName = await prisma.product.findFirst({
        where: {
          name: updateData.name,
          laundryId: user.laundryId,
          id: { not: params.productId }
        }
      })

      if (duplicateName) {
        return errorResponse('A product with this name already exists', 409)
      }
    }

    // Mettre à jour le produit - CORRECTION: inclure tous les champs
    const updatedProduct = await prisma.product.update({
      where: { id: params.productId },
      data: updateData,
      select: {
        id: true,
        name: true,
        description: true,
        category: true,
        price: true,
        unit: true,
        isActive: true,
        // estimatedDuration: true, // DÉCOMMENTÉ
        // specialInstructions: true, // DÉCOMMENTÉ
        updatedAt: true
      }
    })

    // Créer une activité (avec gestion d'erreur)
    try {
      await prisma.activity.create({
        data: {
          type: 'PRODUCT_UPDATED',
          title: 'Produit mis à jour',
          description: `Produit "${updatedProduct.name}" mis à jour`,
          userId: user.sub,
          metadata: {
            productId: updatedProduct.id,
            productName: updatedProduct.name,
            changes: updateData
          }
        }
      })
    } catch (activityError) {
      console.log('Warning: Failed to create activity:', activityError)
      // Continue même si l'activité échoue
    }

    return successResponse(updatedProduct, 'Product updated successfully')
  } catch (error) {
    console.error('Update product error:', error)
    return errorResponse('Failed to update product', 500)
  }
}

// DELETE /api/admin/products/[productId] - ADMIN uniquement
export async function DELETE(
  request: NextRequest,
  { params }: { params: { productId: string } }
) {
  const authResult = await requireRole(request, ['ADMIN'], { requireLaundry: true })
  
  if (authResult instanceof NextResponse) {
    return authResult
  }

  const { user } = authResult

  try {
    // Vérifier que le produit appartient à la laundry de l'admin
    const product = await prisma.product.findFirst({
      where: {
        id: params.productId,
        laundryId: user.laundryId
      },
      include: {
        _count: {
          select: {
            orderItems: {
              where: {
                order: {
                  status: {
                    in: ['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY']
                  }
                }
              }
            }
          }
        }
      }
    })

    if (!product) {
      return errorResponse('Product not found', 404)
    }

    // Vérifier qu'il n'y a pas de commandes actives avec ce produit
    if (product._count.orderItems > 0) {
      return errorResponse(
        'Cannot delete product: it is used in active orders. Please complete active orders first or mark the product as inactive.',
        400
      )
    }

    // Désactiver le produit au lieu de le supprimer (soft delete recommandé)
    const deactivatedProduct = await prisma.product.update({
      where: { id: params.productId },
      data: { 
        isActive: false,
        updatedAt: new Date()
      },
      select: {
        id: true,
        name: true,
        isActive: true
      }
    })

    // Créer une activité (avec gestion d'erreur)
    try {
      await prisma.activity.create({
        data: {
          type: 'PRODUCT_DELETED',
          title: 'Produit désactivé',
          description: `Produit "${product.name}" désactivé (soft delete)`,
          userId: user.sub,
          metadata: {
            productId: product.id,
            productName: product.name
          }
        }
      })
    } catch (activityError) {
      console.log('Warning: Failed to create activity:', activityError)
      // Continue même si l'activité échoue
    }

    return successResponse({
      productId: deactivatedProduct.id,
      name: deactivatedProduct.name,
      isActive: deactivatedProduct.isActive,
      action: 'deactivated'
    }, 'Product deactivated successfully')
  } catch (error) {
    console.error('Delete product error:', error)
    return errorResponse('Failed to delete product', 500)
  }
}
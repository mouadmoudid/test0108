// app/api/super-admin/orders/route.ts - SUPER_ADMIN uniquement
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole, successResponse, errorResponse } from '@/lib/auth-middleware'
import { z } from 'zod'

const superAdminOrdersQuerySchema = z.object({
  page: z.coerce.number().min(1).optional().default(1),
  limit: z.coerce.number().min(1).max(100).optional().default(20),
  search: z.string().optional(),
  status: z.string().optional(),
  laundryId: z.string().optional(),
  sortBy: z.enum(['createdAt', 'finalAmount', 'status']).optional().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc')
})

export async function GET(request: NextRequest) {
  const authResult = await requireRole(request, ['SUPER_ADMIN'])
  
  if (authResult instanceof NextResponse) {
    return authResult
  }

  try {
    const { searchParams } = new URL(request.url)
    const queryParams = Object.fromEntries(searchParams.entries())
    
    const parsed = superAdminOrdersQuerySchema.safeParse(queryParams)
    if (!parsed.success) {
      return errorResponse('Invalid query parameters')
    }

    const { page, limit, search, status, laundryId, sortBy, sortOrder } = parsed.data
    const offset = (page - 1) * limit

    // Construire les conditions de filtrage
    const where: any = {}

    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { user: { name: { contains: search, mode: 'insensitive' } } },
        { laundry: { name: { contains: search, mode: 'insensitive' } } }
      ]
    }

    if (status) {
      where.status = status
    }

    if (laundryId) {
      where.laundryId = laundryId
    }

    const [orders, totalCount] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true
            }
          },
          laundry: {
            select: {
              id: true,
              name: true,
              status: true
            }
          },
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
          address: {
            select: {
              city: true,
              state: true
            }
          }
        },
        orderBy: {
          [sortBy]: sortOrder
        },
        skip: offset,
        take: limit
      }),
      prisma.order.count({ where })
    ])

    const formattedOrders = orders.map(order => {
      const primaryService = order.orderItems[0]?.product.category || 'Service général'
      const totalItems = order.orderItems.reduce((sum, item) => sum + item.quantity, 0)
      
      // Calculer si la commande est en retard
      const isOverdue = order.deliveryDate && 
        order.deliveryDate < new Date() && 
        !['DELIVERED', 'COMPLETED', 'CANCELED'].includes(order.status)

      return {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        
        // Client
        customer: {
          id: order.customer.id,
          name: order.customer.name,
          email: order.customer.email,
          phone: order.customer.phone
        },
        
        // Laundry
        laundry: {
          id: order.laundry.id,
          name: order.laundry.name,
          status: order.laundry.status
        },
        
        // Détails de la commande
        service: {
          primary: primaryService,
          totalItems
        },
        
        // Montants
        pricing: {
          totalAmount: order.totalAmount,
          finalAmount: order.finalAmount,
          deliveryFee: order.deliveryFee || 0
        },
        
        // Localisation
        location: {
          city: order.address.city,
          state: order.address.state
        },
        
        // Dates
        dates: {
          orderDate: order.createdAt,
          deliveryDate: order.deliveryDate,
          lastUpdated: order.updatedAt
        },
        
        // Statut
        flags: {
          isOverdue,
          needsAttention: isOverdue || order.status === 'PENDING',
          priority: isOverdue ? 'high' : 'normal'
        }
      }
    })

    const totalPages = Math.ceil(totalCount / limit)

    return successResponse({
      orders: formattedOrders,
      pagination: {
        currentPage: page,
        totalPages,
        totalCount,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1
      }
    }, 'Super admin orders retrieved successfully')
  } catch (error) {
    console.error('Super admin orders error:', error)
    return errorResponse('Failed to retrieve orders', 500)
  }
}
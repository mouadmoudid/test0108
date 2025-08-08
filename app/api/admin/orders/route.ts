// app/api/admin/orders/route.ts - ADMIN uniquement
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-middleware'
import { z } from 'zod'

// Query schema for orders
const ordersQuerySchema = z.object({
  page: z.coerce.number().min(1).optional().default(1),
  limit: z.coerce.number().min(1).max(100).optional().default(20),
  status: z.string().optional(),
  service: z.string().optional(),
  search: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  sortBy: z.enum(['createdAt', 'finalAmount', 'status', 'orderNumber']).optional().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc')
})

export async function GET(request: NextRequest) {
  // Vérifier que l'utilisateur est ADMIN UNIQUEMENT
  const authResult = await requireRole(request, ['ADMIN'])
  
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
    // Vérifier que l'admin a une laundry associée
    const adminUser = await prisma.user.findUnique({
      where: { id: user.sub },
      include: { laundry: true }
    })

    if (!adminUser?.laundry) {
      return NextResponse.json(
        { success: false, message: 'Admin must be associated with a laundry' },
        { status: 403 }
      )
    }

    const laundryId = adminUser.laundry.id

    // Valider les paramètres de requête
    const { searchParams } = new URL(request.url)
    const queryParams = Object.fromEntries(searchParams.entries())

    const parsed = ordersQuerySchema.safeParse(queryParams)
    if (!parsed.success) {
      return NextResponse.json(
        { 
          success: false, 
          message: 'Invalid query parameters', 
          errors: parsed.error.errors 
        },
        { status: 400 }
      )
    }

    const { page, limit, status, service, search, startDate, endDate, sortBy, sortOrder } = parsed.data

    // Construire les conditions de filtre
    const whereConditions: any = {
      laundryId // Un admin ne voit que les commandes de sa laundry
    }

    if (status) {
      whereConditions.status = status
    }

    if (search) {
      whereConditions.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { customer: { email: { contains: search, mode: 'insensitive' } } }
      ]
    }

    if (startDate || endDate) {
      whereConditions.createdAt = {}
      if (startDate) {
        whereConditions.createdAt.gte = new Date(startDate)
      }
      if (endDate) {
        whereConditions.createdAt.lte = new Date(endDate)
      }
    }

    // Récupérer les commandes avec pagination
    const [orders, totalCount] = await Promise.all([
      prisma.order.findMany({
        where: whereConditions,
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true
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
          },
          _count: {
            select: {
              orderItems: true
            }
          }
        },
        orderBy: {
          [sortBy]: sortOrder
        },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.order.count({ where: whereConditions })
    ])

    const totalPages = Math.ceil(totalCount / limit)

    // Formater les données
    const formattedOrders = orders.map(order => ({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      customer: order.customer,
      address: order.address,
      orderSummary: {
        totalAmount: order.totalAmount,
        deliveryFee: order.deliveryFee,
        discount: order.discount,
        finalAmount: order.finalAmount,
        itemCount: order._count.orderItems
      },
      dates: {
        orderDate: order.createdAt,
        pickupDate: order.pickupDate,
        deliveryDate: order.deliveryDate,
        lastUpdated: order.updatedAt
      },
      notes: order.notes
    }))

    return NextResponse.json({
      success: true,
      message: 'Orders retrieved successfully',
      data: {
        orders: formattedOrders,
        pagination: {
          page,
          limit,
          total: totalCount,
          totalPages
        },
        filters: {
          laundryId,
          status,
          service,
          search,
          startDate,
          endDate
        }
      },
      requestedBy: {
        userId: user.sub,
        role: user.role,
        laundryId,
        laundryName: adminUser.laundry.name
      }
    })

  } catch (error) {
    console.error('Admin orders error:', error)
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    )
  }
}
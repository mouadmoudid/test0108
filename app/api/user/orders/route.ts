// app/api/user/orders/route.ts - CUSTOMER uniquement
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole, successResponse, errorResponse } from '@/lib/auth-middleware'
import { z } from 'zod'

const createOrderSchema = z.object({
  laundryId: z.string().min(1, 'Laundry ID is required'),
  addressId: z.string().min(1, 'Address ID is required'),
  items: z.array(z.object({
    productId: z.string().min(1, 'Product ID is required'),
    quantity: z.coerce.number().min(1, 'Quantity must be at least 1')
  })).min(1, 'At least one item is required'),
  pickupDate: z.string().datetime().optional(),
  deliveryDate: z.string().datetime().optional(),
  notes: z.string().max(500, 'Notes cannot exceed 500 characters').optional()
})

const ordersQuerySchema = z.object({
  page: z.coerce.number().min(1).optional().default(1),
  limit: z.coerce.number().min(1).max(50).optional().default(20),
  status: z.string().optional(),
  search: z.string().optional()
})

// GET /api/user/orders - CUSTOMER uniquement
export async function GET(request: NextRequest) {
  const authResult = await requireRole(request, ['CUSTOMER'])
  
  if (authResult instanceof NextResponse) {
    return authResult
  }

  const { user } = authResult

  try {
    const { searchParams } = new URL(request.url)
    const queryParams = Object.fromEntries(searchParams.entries())
    
    const parsed = ordersQuerySchema.safeParse(queryParams)
    if (!parsed.success) {
      return errorResponse('Invalid query parameters')
    }

    const { page, limit, status, search } = parsed.data
    const offset = (page - 1) * limit

    // Construire les conditions de filtrage
    const where: any = {
      userId: user.sub
    }

    if (status) {
      where.status = status
    }

    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { 
          orderItems: {
            some: {
              product: {
                name: { contains: search, mode: 'insensitive' }
              }
            }
          }
        }
      ]
    }

    const [orders, totalCount] = await Promise.all([
      prisma.order.findMany({
        where,
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
        },
        skip: offset,
        take: limit
      }),
      prisma.order.count({ where })
    ])

    const formattedOrders = orders.map(order => {
      const primaryService = order.orderItems[0]?.product.category || 'Service général'
      const totalItems = order.orderItems.reduce((sum, item) => sum + item.quantity, 0)
      
      return {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        primaryService,
        totalItems,
        finalAmount: order.finalAmount,
        
        laundry: {
          name: order.laundry.name,
          phone: order.laundry.phone
        },
        
        deliveryAddress: {
          street: order.address.street,
          city: order.address.city
        },
        
        dates: {
          orderDate: order.createdAt,
          pickupDate: order.pickupDate,
          deliveryDate: order.deliveryDate
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
    }, 'Orders retrieved successfully')
  } catch (error) {
    console.error('Get orders error:', error)
    return errorResponse('Failed to retrieve orders', 500)
  }
}

// POST /api/user/orders - CUSTOMER uniquement
export async function POST(request: NextRequest) {
  const authResult = await requireRole(request, ['CUSTOMER'])
  
  if (authResult instanceof NextResponse) {
    return authResult
  }

  const { user } = authResult

  try {
    const body = await request.json()
    
    const parsed = createOrderSchema.safeParse(body)
    if (!parsed.success) {
      return errorResponse('Validation error', 400)
    }

    const { laundryId, addressId, items, pickupDate, deliveryDate, notes } = parsed.data

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

    // Vérifier que la laundry existe et est active
    const laundry = await prisma.laundry.findUnique({
      where: {
        id: laundryId,
        status: 'ACTIVE'
      }
    })

    if (!laundry) {
      return errorResponse('Laundry not found or inactive', 400)
    }

    // Récupérer et valider tous les produits
    const productIds = items.map(item => item.productId)
    const products = await prisma.product.findMany({
      where: {
        id: { in: productIds },
        laundryId: laundryId,
        isActive: true
      }
    })

    if (products.length !== productIds.length) {
      return errorResponse('Some products are not available', 400)
    }

    // Calculer les montants
    let totalAmount = 0
    const orderItemsData = items.map(item => {
      const product = products.find(p => p.id === item.productId)!
      const totalPrice = product.price * item.quantity
      totalAmount += totalPrice

      return {
        productId: item.productId,
        quantity: item.quantity,
        price: product.price,
        totalPrice
      }
    })

    // Calculer les frais de livraison (logique simplifiée)
    const deliveryFee = 20 // Vous pouvez implémenter une logique plus complexe

    // Calculer les remises éventuelles
    const discount = 0 // Vous pouvez implémenter une logique de remise

    const finalAmount = totalAmount + deliveryFee - discount

    // Générer un numéro de commande unique
    const orderCount = await prisma.order.count()
    const orderNumber = `ORD-${String(orderCount + 1).padStart(6, '0')}`

    // Créer la commande avec transaction
    const newOrder = await prisma.$transaction(async (tx) => {
      // Créer la commande
      const order = await tx.order.create({
        data: {
          orderNumber,
          customerId: user.sub,
          laundryId,
          addressId,
          status: 'PENDING',
          totalAmount,
          deliveryFee,
          discount,
          finalAmount,
          pickupDate: pickupDate ? new Date(pickupDate) : null,
          deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
          notes: notes || null,
          orderItems: {
            create: orderItemsData
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
          }
        }
      })

      // Créer une activité
      await tx.activity.create({
        data: {
          type: 'ORDER_CREATED',
          title: 'Nouvelle commande créée',
          description: `Commande ${order.orderNumber} créée avec ${items.length} article(s)`,
          orderId: order.id,
          userId: user.sub,
          metadata: {
            orderNumber: order.orderNumber,
            totalAmount: order.finalAmount,
            itemCount: items.length,
            laundryName: order.laundry.name
          }
        }
      })

      return order
    })

    // Formatage de la réponse
    const response = {
      id: newOrder.id,
      orderNumber: newOrder.orderNumber,
      status: newOrder.status,
      totalItems: newOrder.orderItems.length,
      finalAmount: newOrder.finalAmount,
      
      laundry: {
        name: newOrder.laundry.name,
        phone: newOrder.laundry.phone
      },
      
      items: newOrder.orderItems.map(item => ({
        productName: item.product.name,
        category: item.product.category,
        quantity: item.quantity,
        unitPrice: item.price,
        totalPrice: item.totalPrice
      })),
      
      pricing: {
        subtotal: newOrder.totalAmount,
        deliveryFee: newOrder.deliveryFee,
        discount: newOrder.discount,
        finalAmount: newOrder.finalAmount
      },
      
      dates: {
        orderDate: newOrder.createdAt,
        estimatedPickup: newOrder.pickupDate,
        estimatedDelivery: newOrder.deliveryDate
      }
    }

    return successResponse(response, 'Order created successfully')
  } catch (error) {
    console.error('Create order error:', error)
    return errorResponse('Failed to create order', 500)
  }
}
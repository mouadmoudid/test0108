// app/api/user/orders/route.ts - Version corrigée
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-middleware'
import { z } from 'zod'

// Order creation schema
const orderCreateSchema = z.object({
  laundryId: z.string().min(1, 'Laundry ID is required'),
  addressId: z.string().min(1, 'Address ID is required'),
  items: z.array(z.object({
    productId: z.string().min(1, 'Product ID is required'),
    quantity: z.number().min(1, 'Quantity must be at least 1')
  })).min(1, 'At least one item is required'),
  pickupDate: z.string().datetime().optional(),
  deliveryDate: z.string().datetime().optional(),
  notes: z.string().optional(),
})

// GET /api/user/orders - Récupérer les commandes de l'utilisateur connecté
export async function GET(request: NextRequest) {
  const authResult = await requireRole(request, ['CUSTOMER'])
  
  if (authResult instanceof NextResponse) {
    return authResult
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
    // Récupérer les commandes de l'utilisateur connecté
    const orders = await prisma.order.findMany({
      where: { customerId: user.sub },
      include: {
        laundry: {
          select: { name: true, phone: true }
        },
        address: {
          select: { street: true, city: true, state: true }
        },
        orderItems: {
          include: {
            product: {
              select: { name: true, category: true, unit: true }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    return NextResponse.json({
      success: true,
      message: 'Orders retrieved successfully',
      data: orders
    })

  } catch (error) {
    console.error('Get orders error:', error)
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST /api/user/orders - Créer une nouvelle commande pour l'utilisateur connecté
export async function POST(request: NextRequest) {
  const authResult = await requireRole(request, ['CUSTOMER'])
  
  if (authResult instanceof NextResponse) {
    return authResult
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
    const body = await request.json()
    
    const parsed = orderCreateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { 
          success: false, 
          message: 'Validation error', 
          errors: parsed.error.errors 
        },
        { status: 400 }
      )
    }

    const { laundryId, addressId, items, pickupDate, deliveryDate, notes } = parsed.data

    // Vérifier que la laundry existe et est active
    const laundry = await prisma.laundry.findUnique({
      where: { 
        id: laundryId,
        status: 'ACTIVE' 
      }
    })

    if (!laundry) {
      return NextResponse.json(
        { success: false, message: 'Laundry not found or inactive' },
        { status: 404 }
      )
    }

    // Vérifier que l'adresse appartient à l'utilisateur
    const address = await prisma.address.findFirst({
      where: { 
        id: addressId,
        userId: user.sub 
      }
    })

    if (!address) {
      return NextResponse.json(
        { success: false, message: 'Address not found or does not belong to customer' },
        { status: 404 }
      )
    }

    // Récupérer les détails des produits
    const products = await prisma.product.findMany({
      where: { 
        id: { in: items.map(item => item.productId) },
        laundryId 
      }
    })

    if (products.length !== items.length) {
      return NextResponse.json(
        { success: false, message: 'Some products not found or not from the selected laundry' },
        { status: 400 }
      )
    }

    // Calculer le montant total
    let totalAmount = 0
    const orderItemsData = items.map(item => {
      const product = products.find(p => p.id === item.productId)!
      const itemTotal = product.price * item.quantity
      totalAmount += itemTotal
      
      return {
        productId: item.productId,
        quantity: item.quantity,
        price: product.price,
        totalPrice: itemTotal
      }
    })

    const deliveryFee = 10.0 // Fee fixe pour l'exemple
    const finalAmount = totalAmount + deliveryFee

    // Générer un numéro de commande unique
    const orderNumber = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`

    // Créer la commande avec ses items
    const order = await prisma.order.create({
      data: {
        orderNumber,
        customerId: user.sub, // user.sub est maintenant garanti d'être une string
        laundryId,
        addressId,
        totalAmount,
        deliveryFee,
        finalAmount,
        notes,
        pickupDate: pickupDate ? new Date(pickupDate) : null,
        deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
        orderItems: {
          create: orderItemsData
        }
      },
      include: {
        orderItems: {
          include: {
            product: true
          }
        },
        laundry: {
          select: { name: true }
        }
      }
    })

    return NextResponse.json({
      success: true,
      message: 'Order created successfully',
      data: order
    }, { status: 201 })

  } catch (error) {
    console.error('Create order error:', error)
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    )
  }
}
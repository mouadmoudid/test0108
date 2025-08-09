// app/api/admin/products/route.ts - ADMIN uniquement
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole, successResponse, errorResponse } from '@/lib/auth-middleware'
import { z } from 'zod'

const productsQuerySchema = z.object({
  page: z.coerce.number().min(1).optional().default(1),
  limit: z.coerce.number().min(1).max(100).optional().default(20),
  search: z.string().optional(),
  category: z.string().optional(),
  status: z.enum(['ALL', 'ACTIVE', 'INACTIVE']).optional().default('ALL'),
  sortBy: z.enum(['name', 'category', 'price', 'createdAt']).optional().default('name'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('asc')
})

const createProductSchema = z.object({
  name: z.string().min(1, 'Product name is required').max(100),
  description: z.string().optional(),
  category: z.string().min(1, 'Category is required'),
  price: z.coerce.number().min(0, 'Price must be positive'),
  unit: z.string().min(1, 'Unit is required'),
  isActive: z.boolean().optional().default(true),
  estimatedDuration: z.coerce.number().min(1).optional(), // en heures
  specialInstructions: z.string().optional()
})

// GET /api/admin/products - ADMIN uniquement
export async function GET(request: NextRequest) {
  const authResult = await requireRole(request, ['ADMIN'], { requireLaundry: true })
  
  if (authResult instanceof NextResponse) {
    return authResult
  }

  const { user } = authResult

  try {
    const { searchParams } = new URL(request.url)
    const queryParams = Object.fromEntries(searchParams.entries())
    
    const parsed = productsQuerySchema.safeParse(queryParams)
    if (!parsed.success) {
      return errorResponse('Invalid query parameters')
    }

    const { page, limit, search, category, status, sortBy, sortOrder } = parsed.data
    const offset = (page - 1) * limit

    // Construire les conditions de filtrage
    const where: any = {
      laundryId: user.laundryId
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { category: { contains: search, mode: 'insensitive' } }
      ]
    }

    if (category) {
      where.category = category
    }

    if (status !== 'ALL') {
      where.isActive = status === 'ACTIVE'
    }

    const [products, totalCount] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          _count: {
            select: {
              orderItems: {
                where: {
                  order: {
                    createdAt: {
                      gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // 30 derniers jours
                    }
                  }
                }
              }
            }
          }
        },
        orderBy: {
          [sortBy]: sortOrder
        },
        skip: offset,
        take: limit
      }),
      prisma.product.count({ where })
    ])

    // Calculer les statistiques pour chaque produit
    const enrichedProducts = await Promise.all(
      products.map(async (product) => {
        // Revenue des 30 derniers jours
        const revenueStats = await prisma.orderItem.aggregate({
          where: {
            productId: product.id,
            order: {
              status: { in: ['DELIVERED', 'COMPLETED'] },
              createdAt: {
                gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
              }
            }
          },
          _sum: { totalPrice: true },
          _count: { id: true }
        })

        return {
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
          
          // Statistiques
          stats: {
            ordersThisMonth: product._count.orderItems,
            revenueThisMonth: revenueStats._sum.totalPrice || 0,
            totalSold: revenueStats._count.id || 0
          }
        }
      })
    )

    const totalPages = Math.ceil(totalCount / limit)

    return successResponse({
      products: enrichedProducts,
      pagination: {
        currentPage: page,
        totalPages,
        totalCount,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1
      }
    }, 'Products retrieved successfully')
  } catch (error) {
    console.error('Get products error:', error)
    return errorResponse('Failed to retrieve products', 500)
  }
}

// POST /api/admin/products - ADMIN uniquement
export async function POST(request: NextRequest) {
  const authResult = await requireRole(request, ['ADMIN'], { requireLaundry: true })
  
  if (authResult instanceof NextResponse) {
    return authResult
  }

  const { user } = authResult

  try {
    const body = await request.json()
    
    const parsed = createProductSchema.safeParse(body)
    if (!parsed.success) {
      return errorResponse('Validation error', 400)
    }

    const productData = parsed.data

    // Vérifier que le nom du produit n'existe pas déjà pour cette laundry
    const existingProduct = await prisma.product.findFirst({
      where: {
        name: productData.name,
        laundryId: user.laundryId
      }
    })

    if (existingProduct) {
      return errorResponse('A product with this name already exists', 409)
    }

    // Créer le produit
    const newProduct = await prisma.product.create({
      data: {
        ...productData,
        laundryId: user.laundryId!
      },
      select: {
        id: true,
        name: true,
        description: true,
        category: true,
        price: true,
        unit: true,
        isActive: true,
        // estimatedDuration: true,
        // specialInstructions: true,
        createdAt: true
      }
    })

    // Créer une activité
    await prisma.activity.create({
      data: {
        type: 'PRODUCT_ADDED',
        title: 'Nouveau produit ajouté',
        description: `Produit "${newProduct.name}" ajouté dans la catégorie ${newProduct.category}`,
        userId: user.sub,
        metadata: {
          productId: newProduct.id,
          productName: newProduct.name,
          category: newProduct.category,
          price: newProduct.price
        }
      }
    })

    return successResponse(newProduct, 'Product created successfully')
  } catch (error) {
    console.error('Create product error:', error)
    return errorResponse('Failed to create product', 500)
  }
}
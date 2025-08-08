// app/api/admin/products/route.ts
import { prisma } from '@/lib/prisma'
import { successResponse, errorResponse } from '@/lib/response'
import { validateQuery } from '@/lib/validations'
import { NextRequest } from 'next/server'
import { z } from 'zod'

// Query schema for products list (redefined to ensure no status field)
const productsQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  category: z.string().optional(),
  sortBy: z.enum(['name', 'price', 'category', 'createdAt', 'orders', 'revenue']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
})

// Product creation/update schema
const productSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().nullish(),
  price: z.number().min(0, 'Price must be positive'),
  category: z.string().nullish(),
  unit: z.string().nullish()
})

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const laundryId = searchParams.get('laundryId')

    if (!laundryId) {
      return errorResponse('laundryId parameter is required', 400)
    }

    // Verify laundry exists
    const laundry = await prisma.laundry.findUnique({
      where: { id: laundryId }
    })

    if (!laundry) {
      return errorResponse('Laundry not found', 404)
    }

    // Validate query parameters
    const queryParams = Object.fromEntries(searchParams.entries())
    delete queryParams.laundryId

    const validatedQuery = validateQuery(productsQuerySchema, queryParams)
    if (!validatedQuery) {
      return errorResponse('Invalid query parameters', 400)
    }

    const { page=1, limit=20, search, status, category, sortBy, sortOrder } = validatedQuery

    // Build where conditions
    const whereConditions: any = {
      laundryId
    }

    if (status) {
      whereConditions.status = status
    }

    if (category) {
      whereConditions.category = {
        contains: category,
        mode: 'insensitive'
      }
    }

    if (search) {
      whereConditions.OR = [
        {
          name: {
            contains: search,
            mode: 'insensitive'
          }
        },
        {
          description: {
            contains: search,
            mode: 'insensitive'
          }
        }
      ]
    }

    // Get products with order statistics
    const products = await prisma.product.findMany({
      where: whereConditions,
      include: {
        orderItems: {
          include: {
            order: {
              select: {
                status: true,
                createdAt: true
              }
            }
          }
        }
      }
    })

    // Calculate statistics for each product
    const productsWithStats = products.map(product => {
      const completedOrderItems = product.orderItems.filter(item => 
        ['COMPLETED', 'DELIVERED'].includes(item.order.status)
      )
      
      const totalQuantitySold = completedOrderItems.reduce((sum, item) => sum + item.quantity, 0)
      const totalRevenue = completedOrderItems.reduce((sum, item) => sum + item.totalPrice, 0)
      const totalOrders = new Set(completedOrderItems.map(item => item.orderId)).size
      
      // Calculate last 30 days activity
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      const recentOrderItems = completedOrderItems.filter(item => 
        item.order.createdAt >= thirtyDaysAgo
      )
      const recentRevenue = recentOrderItems.reduce((sum, item) => sum + item.totalPrice, 0)

      return {
        id: product.id,
        name: product.name,
        description: product.description,
        price: product.price,
        category: product.category || 'Uncategorized',
        unit: product.unit,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
        stats: {
          totalQuantitySold,
          totalRevenue,
          totalOrders,
          recentRevenue,
          averageOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0
        }
      }
    })

    // Sort products
    productsWithStats.sort((a, b) => {
      let aValue: any, bValue: any
      
      switch (sortBy) {
        case 'name':
          aValue = a.name.toLowerCase()
          bValue = b.name.toLowerCase()
          break
        case 'price':
          aValue = a.price
          bValue = b.price
          break
        case 'category':
          aValue = a.category.toLowerCase()
          bValue = b.category.toLowerCase()
          break
        case 'orders':
          aValue = a.stats.totalOrders
          bValue = b.stats.totalOrders
          break
        case 'revenue':
          aValue = a.stats.totalRevenue
          bValue = b.stats.totalRevenue
          break
        case 'createdAt':
          aValue = a.createdAt
          bValue = b.createdAt
          break
        default:
          aValue = a.createdAt
          bValue = b.createdAt
      }

      if (sortOrder === 'asc') {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0
      } else {
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0
      }
    })

    // Apply pagination
    const totalCount = productsWithStats.length
    const offset = (page - 1) * limit
    const paginatedProducts = productsWithStats.slice(offset, offset + limit)

    // Calculate pagination info
    const totalPages = Math.ceil(totalCount / limit)
    const hasNextPage = page < totalPages
    const hasPrevPage = page > 1

    // Get summary statistics
    const totalRevenue = productsWithStats.reduce((sum, product) => sum + product.stats.totalRevenue, 0)
    const totalQuantitySold = productsWithStats.reduce((sum, product) => sum + product.stats.totalQuantitySold, 0)

    const response = {
      products: paginatedProducts,
      pagination: {
        currentPage: page,
        totalPages,
        totalCount,
        limit,
        hasNextPage,
        hasPrevPage,
        showing: paginatedProducts.length
      },
      summary: {
        totalProducts: totalCount,
        totalRevenue,
        totalQuantitySold,
        averagePrice: totalCount > 0 ? 
          productsWithStats.reduce((sum, p) => sum + p.price, 0) / totalCount : 0
      },
      filters: {
        search: search || null,
        category: category || null,
        sortBy,
        sortOrder
      }
    }

    return successResponse(response, 'Products retrieved successfully')
  } catch (error) {
    console.error('Get products error:', error)
    return errorResponse('Failed to retrieve products', 500)
  }
}

// POST /api/admin/products
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const laundryId = searchParams.get('laundryId')

    if (!laundryId) {
      return errorResponse('laundryId parameter is required', 400)
    }

    // Verify laundry exists
    const laundry = await prisma.laundry.findUnique({
      where: { id: laundryId }
    })

    if (!laundry) {
      return errorResponse('Laundry not found', 404)
    }

    const body = await request.json()
    const validatedData = validateQuery(productSchema, body)
    
    if (!validatedData) {
      return errorResponse('Invalid product data', 400)
    }

    // Check if product with same name already exists
    const existingProduct = await prisma.product.findFirst({
      where: {
        laundryId,
        name: {
          equals: validatedData.name,
          mode: 'insensitive'
        }
      }
    })

    if (existingProduct) {
      return errorResponse('Product with this name already exists', 400)
    }

    // Create new product
    const productData: any = {
      name: validatedData.name,
      price: validatedData.price,
      laundryId,
      // Set default values for required fields that might be nullable
      unit: validatedData.unit || 'piece'
    }

    // Only add optional fields if they have actual values (not null/undefined)
    if (validatedData.description && validatedData.description.trim() !== '') {
      productData.description = validatedData.description
    }
    if (validatedData.category && validatedData.category.trim() !== '') {
      productData.category = validatedData.category
    }

    const newProduct = await prisma.product.create({
      data: productData
    })

    // Skip activity creation for now to avoid enum errors
    // TODO: Add activity logging once ActivityType enum is confirmed
    
    return successResponse(newProduct, 'Product created successfully')
  } catch (error) {
    console.error('Create product error:', error)
    return errorResponse('Failed to create product', 500)
  }
}
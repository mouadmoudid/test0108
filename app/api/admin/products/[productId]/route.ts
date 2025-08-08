// app/api/admin/products/[productId]/route.ts
import { prisma } from '@/lib/prisma'
import { successResponse, errorResponse } from '@/lib/response'
import { validateQuery } from '@/lib/validations'
import { NextRequest } from 'next/server'
import { z } from 'zod'

// Product update schema
const productUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullish(),
  price: z.number().min(0).optional(),
  category: z.string().nullish(),
  unit: z.string().nullish()
})

// PUT /api/admin/products/[productId]
export async function PUT(
  request: NextRequest,
  { params }: { params: { productId: string } }
) {
  try {
    const { productId } = params
    const { searchParams } = new URL(request.url)
    const laundryId = searchParams.get('laundryId')

    if (!laundryId) {
      return errorResponse('laundryId parameter is required', 400)
    }

    // Check if product exists and belongs to this laundry
    const existingProduct = await prisma.product.findFirst({
      where: { 
        id: productId,
        laundryId 
      }
    })

    if (!existingProduct) {
      return errorResponse('Product not found or does not belong to this laundry', 404)
    }

    const body = await request.json()
    const validatedData = validateQuery(productUpdateSchema, body)
    
    if (!validatedData) {
      return errorResponse('Invalid product data', 400)
    }

    // Check if updating name and it conflicts with existing product
    if (validatedData.name && validatedData.name !== existingProduct.name) {
      const conflictingProduct = await prisma.product.findFirst({
        where: {
          laundryId,
          name: {
            equals: validatedData.name,
            mode: 'insensitive'
          },
          id: { not: productId }
        }
      })

      if (conflictingProduct) {
        return errorResponse('Product with this name already exists', 400)
      }
    }

    // Prepare update data, filtering out undefined values
    const updateData: any = {}
    
    if (validatedData.name !== undefined) {
      updateData.name = validatedData.name
    }
    if (validatedData.description !== undefined) {
      updateData.description = validatedData.description
    }
    if (validatedData.price !== undefined) {
      updateData.price = validatedData.price
    }
    if (validatedData.category !== undefined) {
      updateData.category = validatedData.category
    }
    if (validatedData.unit !== undefined) {
      updateData.unit = validatedData.unit
    }

    // Update product
    const updatedProduct = await prisma.product.update({
      where: { id: productId },
      data: updateData
    })

    // Create activity record
    await prisma.activity.create({
      data: {
        type: 'PRODUCT_UPDATED',
        title: 'Product updated',
        description: `Product "${updatedProduct.name}" was updated`,
        laundryId,
        metadata: {
          productId: updatedProduct.id,
          productName: updatedProduct.name,
          changes: validatedData
        }
      }
    })

    return successResponse(updatedProduct, 'Product updated successfully')
  } catch (error) {
    console.error('Update product error:', error)
    return errorResponse('Failed to update product', 500)
  }
}

// PATCH /api/admin/products/[productId] (alternative to PUT)
export async function PATCH(
  request: NextRequest,
  { params }: { params: { productId: string } }
) {
  return PUT(request, { params })
}

// DELETE /api/admin/products/[productId]
export async function DELETE(
  request: NextRequest,
  { params }: { params: { productId: string } }
) {
  try {
    const { productId } = params
    const { searchParams } = new URL(request.url)
    const laundryId = searchParams.get('laundryId')

    if (!laundryId) {
      return errorResponse('laundryId parameter is required', 400)
    }

    // Check if product exists and belongs to this laundry
    const existingProduct = await prisma.product.findFirst({
      where: { 
        id: productId,
        laundryId 
      },
      include: {
        orderItems: {
          include: {
            order: {
              select: {
                status: true
              }
            }
          }
        }
      }
    })

    if (!existingProduct) {
      return errorResponse('Product not found or does not belong to this laundry', 404)
    }

    // Check if product has active orders
    const hasActiveOrders = existingProduct.orderItems.some(item => 
      ['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY'].includes(item.order.status)
    )

    if (hasActiveOrders) {
      return errorResponse('Cannot delete product with active orders. Please complete or cancel active orders first.', 400)
    }

    // Instead of hard delete, we can soft delete by marking as deleted in name
    // or we can hard delete if there are no order items at all
    if (existingProduct.orderItems.length === 0) {
      // Hard delete if no order history
      await prisma.product.delete({
        where: { id: productId }
      })
    } else {
      // Soft delete by modifying the name to indicate deletion
      await prisma.product.update({
        where: { id: productId },
        data: { 
          name: `${existingProduct.name} (Deleted)`,
          updatedAt: new Date()
        }
      })
    }

    // Create activity record
    await prisma.activity.create({
      data: {
        type: 'PRODUCT_DELETED',
        title: 'Product deleted',
        description: `Product "${existingProduct.name}" was deleted`,
        laundryId,
        metadata: {
          productId: existingProduct.id,
          productName: existingProduct.name,
          hadOrderHistory: existingProduct.orderItems.length > 0
        }
      }
    })

    return successResponse(
      { productId, deleted: true }, 
      'Product deleted successfully'
    )
  } catch (error) {
    console.error('Delete product error:', error)
    return errorResponse('Failed to delete product', 500)
  }
}
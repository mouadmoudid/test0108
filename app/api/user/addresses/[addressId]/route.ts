// app/api/user/addresses/[addressId]/route.ts
import { prisma } from '@/lib/prisma'
import { successResponse, errorResponse } from '@/lib/response'
import { validateQuery } from '@/lib/validations'
import { NextRequest } from 'next/server'
import { z } from 'zod'

// Address update schema
const addressUpdateSchema = z.object({
  street: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  zipCode: z.string().min(1).optional(),
  country: z.string().optional(),
  isDefault: z.boolean().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
})

// PUT /api/user/addresses/[addressId]?userId=xxx
export async function PUT(
  request: NextRequest,
  { params }: { params: { addressId: string } }
) {
  try {
    const { addressId } = params
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')

    if (!userId) {
      return errorResponse('userId parameter is required', 400)
    }
    
    const body = await request.json()
    const validatedData = validateQuery(addressUpdateSchema, body)
    
    if (!validatedData) {
      return errorResponse('Invalid address data', 400)
    }

    // Check if address exists and belongs to user
    const existingAddress = await prisma.address.findFirst({
      where: { 
        id: addressId,
        userId 
      }
    })

    if (!existingAddress) {
      return errorResponse('Address not found or does not belong to customer', 404)
    }

    // If this is being set as default, unset all other default addresses
    if (validatedData.isDefault) {
      await prisma.address.updateMany({
        where: { 
          userId,
          isDefault: true,
          id: { not: addressId }
        },
        data: { isDefault: false }
      })
    }

    // Update address
    const updatedAddress = await prisma.address.update({
      where: { id: addressId },
      data: validatedData,
      select: {
        id: true,
        street: true,
        city: true,
        state: true,
        zipCode: true,
        country: true,
        isDefault: true,
        latitude: true,
        longitude: true,
        updatedAt: true
      }
    })

    return successResponse(updatedAddress, 'Address updated successfully')
  } catch (error) {
    console.error('Update address error:', error)
    return errorResponse('Failed to update address', 500)
  }
}

// DELETE /api/user/addresses/[addressId]?userId=xxx
export async function DELETE(
  request: NextRequest,
  { params }: { params: { addressId: string } }
) {
  try {
    const { addressId } = params
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')

    if (!userId) {
      return errorResponse('userId parameter is required', 400)
    }

    // Check if address exists and belongs to user
    const existingAddress = await prisma.address.findFirst({
      where: { 
        id: addressId,
        userId 
      }
    })

    if (!existingAddress) {
      return errorResponse('Address not found or does not belong to customer', 404)
    }

    // Don't allow deletion if it's being used in any orders
    const ordersUsingAddress = await prisma.order.count({
      where: { addressId }
    })

    if (ordersUsingAddress > 0) {
      return errorResponse('Cannot delete address that is being used in orders', 400)
    }

    // Delete address
    await prisma.address.delete({
      where: { id: addressId }
    })

    // If deleted address was default, set another address as default
    if (existingAddress.isDefault) {
      const nextAddress = await prisma.address.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' }
      })

      if (nextAddress) {
        await prisma.address.update({
          where: { id: nextAddress.id },
          data: { isDefault: true }
        })
      }
    }

    return successResponse(null, 'Address deleted successfully')
  } catch (error) {
    console.error('Delete address error:', error)
    return errorResponse('Failed to delete address', 500)
  }
}
// app/api/user/addresses/[addressId]/route.ts - CUSTOMER uniquement
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole, successResponse, errorResponse } from '@/lib/auth-middleware'
import { z } from 'zod'

const updateAddressSchema = z.object({
  street: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  zipCode: z.string().min(1).optional(),
  country: z.string().optional(),
  isDefault: z.boolean().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional()
})

// GET /api/user/addresses/[addressId] - CUSTOMER uniquement
export async function GET(
  request: NextRequest,
  { params }: { params: { addressId: string } }
) {
  const authResult = await requireRole(request, ['CUSTOMER'])
  
  if (authResult instanceof NextResponse) {
    return authResult
  }

  const { user } = authResult

  try {
    const address = await prisma.address.findUnique({
      where: {
        id: params.addressId,
        userId: user.sub // S'assurer que l'adresse appartient au client
      },
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
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            orders: true // Compter les commandes utilisant cette adresse
          }
        }
      }
    })

    if (!address) {
      return errorResponse('Address not found', 404)
    }

    return successResponse(address, 'Address retrieved successfully')
  } catch (error) {
    console.error('Get address error:', error)
    return errorResponse('Failed to retrieve address', 500)
  }
}

// PUT /api/user/addresses/[addressId] - CUSTOMER uniquement
export async function PUT(
  request: NextRequest,
  { params }: { params: { addressId: string } }
) {
  const authResult = await requireRole(request, ['CUSTOMER'])
  
  if (authResult instanceof NextResponse) {
    return authResult
  }

  const { user } = authResult

  try {
    const body = await request.json()
    
    const parsed = updateAddressSchema.safeParse(body)
    if (!parsed.success) {
      return errorResponse('Validation error', 400)
    }

    const updateData = parsed.data

    // Vérifier que l'adresse appartient au client
    const existingAddress = await prisma.address.findUnique({
      where: {
        id: params.addressId,
        userId: user.sub
      }
    })

    if (!existingAddress) {
      return errorResponse('Address not found', 404)
    }

    // Si on définit cette adresse comme par défaut, retirer le statut par défaut des autres
    if (updateData.isDefault === true) {
      await prisma.address.updateMany({
        where: {
          userId: user.sub,
          id: { not: params.addressId }
        },
        data: {
          isDefault: false
        }
      })
    }

    // Mettre à jour l'adresse
    const updatedAddress = await prisma.address.update({
      where: {
        id: params.addressId
      },
      data: updateData,
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

    // Créer une activité
    await prisma.activity.create({
      data: {
        type: 'ADDRESS_UPDATED',
        title: 'Adresse mise à jour',
        description: `Adresse ${updatedAddress.street}, ${updatedAddress.city} mise à jour`,
        userId: user.sub
      }
    })

    return successResponse(updatedAddress, 'Address updated successfully')
  } catch (error) {
    console.error('Update address error:', error)
    return errorResponse('Failed to update address', 500)
  }
}

// DELETE /api/user/addresses/[addressId] - CUSTOMER uniquement
export async function DELETE(
  request: NextRequest,
  { params }: { params: { addressId: string } }
) {
  const authResult = await requireRole(request, ['CUSTOMER'])
  
  if (authResult instanceof NextResponse) {
    return authResult
  }

  const { user } = authResult

  try {
    // Vérifier que l'adresse appartient au client
    const address = await prisma.address.findUnique({
      where: {
        id: params.addressId,
        userId: user.sub
      },
      include: {
        _count: {
          select: {
            orders: true
          }
        }
      }
    })

    if (!address) {
      return errorResponse('Address not found', 404)
    }

    // Vérifier si l'adresse est utilisée dans des commandes actives
    const activeOrdersCount = await prisma.order.count({
      where: {
        addressId: params.addressId,
        status: {
          in: ['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY']
        }
      }
    })

    if (activeOrdersCount > 0) {
      return errorResponse('Cannot delete address: it is used in active orders', 400)
    }

    // Si c'est l'adresse par défaut, définir une autre adresse comme par défaut
    if (address.isDefault) {
      const otherAddress = await prisma.address.findFirst({
        where: {
          userId: user.sub,
          id: { not: params.addressId }
        }
      })

      if (otherAddress) {
        await prisma.address.update({
          where: { id: otherAddress.id },
          data: { isDefault: true }
        })
      }
    }

    // Supprimer l'adresse
    await prisma.address.delete({
      where: { id: params.addressId }
    })

    // Créer une activité
    await prisma.activity.create({
      data: {
        type: 'ADDRESS_DELETED',
        title: 'Adresse supprimée',
        description: `Adresse ${address.street}, ${address.city} supprimée`,
        userId: user.sub
      }
    })

    return successResponse(
      { deletedAddressId: params.addressId },
      'Address deleted successfully'
    )
  } catch (error) {
    console.error('Delete address error:', error)
    return errorResponse('Failed to delete address', 500)
  }
}
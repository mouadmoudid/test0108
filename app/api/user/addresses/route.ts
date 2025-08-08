// app/api/user/addresses/route.ts - CUSTOMER uniquement
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-middleware'
import { z } from 'zod'

// Address creation/update schema
const addressSchema = z.object({
  street: z.string().min(1, 'Street is required'),
  city: z.string().min(1, 'City is required'),
  state: z.string().min(1, 'State is required'),
  zipCode: z.string().min(1, 'ZIP code is required'),
  country: z.string().default('Morocco'),
  isDefault: z.boolean().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
})

// GET /api/user/addresses - CUSTOMER UNIQUEMENT
export async function GET(request: NextRequest) {
  const authResult = await requireRole(request, ['CUSTOMER'])
  
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
    const addresses = await prisma.address.findMany({
      where: { userId: user.sub },
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
        updatedAt: true
      },
      orderBy: [
        { isDefault: 'desc' },
        { createdAt: 'desc' }
      ]
    })

    return NextResponse.json({
      success: true,
      message: 'Addresses retrieved successfully',
      data: addresses
    })
  } catch (error) {
    console.error('Get addresses error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to retrieve addresses' },
      { status: 500 }
    )
  }
}

// POST /api/user/addresses - CUSTOMER UNIQUEMENT
export async function POST(request: NextRequest) {
  const authResult = await requireRole(request, ['CUSTOMER'])
  
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
    const body = await request.json()
    
    const parsed = addressSchema.safeParse(body)
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

    // Si cette adresse est définie comme par défaut, désactiver les autres
    if (parsed.data.isDefault) {
      await prisma.address.updateMany({
        where: { 
          userId: user.sub,
          isDefault: true 
        },
        data: { isDefault: false }
      })
    }

    // Créer l'adresse avec userId explicitement défini
    const newAddress = await prisma.address.create({
      data: {
        userId: user.sub, // user.sub est maintenant garanti d'être une string
        street: parsed.data.street,
        city: parsed.data.city,
        state: parsed.data.state,
        zipCode: parsed.data.zipCode,
        country: parsed.data.country,
        isDefault: parsed.data.isDefault ?? false,
        latitude: parsed.data.latitude,
        longitude: parsed.data.longitude,
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
        createdAt: true
      }
    })

    return NextResponse.json({
      success: true,
      message: 'Address created successfully',
      data: newAddress
    }, { status: 201 })

  } catch (error) {
    console.error('Create address error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to create address' },
      { status: 500 }
    )
  }
}
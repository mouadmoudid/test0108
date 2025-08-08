// app/api/user/profile/route.ts - CUSTOMER uniquement
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-middleware'
import { z } from 'zod'

const updateProfileSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().optional(),
  avatar: z.string().url().optional()
})

// GET /api/user/profile - CUSTOMER UNIQUEMENT
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
    const userProfile = await prisma.user.findUnique({
      where: { id: user.sub },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        avatar: true,
        createdAt: true,
        _count: {
          select: {
            orders: true,
            addresses: true,
            reviews: true
          }
        }
      }
    })

    if (!userProfile) {
      return NextResponse.json(
        { success: false, message: 'User not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Profile retrieved successfully',
      data: userProfile
    })

  } catch (error) {
    console.error('Get profile error:', error)
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    )
  }
}

// PUT /api/user/profile - CUSTOMER UNIQUEMENT
export async function PUT(request: NextRequest) {
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
    
    const parsed = updateProfileSchema.safeParse(body)
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

    const updatedUser = await prisma.user.update({
      where: { id: user.sub },
      data: parsed.data,
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        avatar: true,
        updatedAt: true
      }
    })

    return NextResponse.json({
      success: true,
      message: 'Profile updated successfully',
      data: updatedUser
    })

  } catch (error) {
    console.error('Update profile error:', error)
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    )
  }
}
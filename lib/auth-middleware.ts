// lib/auth-middleware.ts - Version améliorée avec gestion complète des rôles
import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { prisma } from '@/lib/prisma'

export interface AuthUser {
  sub: string
  email: string
  name: string
  role: string
  laundryId?: string
  isSuspended?: boolean
  suspensionReason?: string
}

export interface AuthResult {
  user: AuthUser
  error: null
}

export async function authenticateUser(request: NextRequest): Promise<AuthResult | NextResponse> {
  try {
    // Récupérer le token depuis l'header Authorization
    const authHeader = request.headers.get('authorization')
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, message: 'Authorization header required' },
        { status: 401 }
      )
    }

    const token = authHeader.substring(7) // Enlever "Bearer "

    if (!token) {
      return NextResponse.json(
        { success: false, message: 'Authentication token required' },
        { status: 401 }
      )
    }

    // Vérifier le JWT
    const secret = new TextEncoder().encode(process.env.NEXTAUTH_SECRET!)
    const { payload } = await jwtVerify(token, secret)

    // Vérifier que l'utilisateur existe toujours et récupérer ses informations actuelles
    const user = await prisma.user.findUnique({
      where: { id: payload.sub as string },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        suspendedAt: true,
        suspensionReason: true,
        laundry: {
          select: {
            id: true
          }
        }
      }
    })

    if (!user) {
      return NextResponse.json(
        { success: false, message: 'User not found' },
        { status: 401 }
      )
    }

    // Vérifier si l'utilisateur est suspendu
    if (user.suspendedAt) {
      return NextResponse.json(
        { 
          success: false, 
          message: 'Account suspended', 
          reason: user.suspensionReason || 'Account temporarily suspended'
        },
        { status: 403 }
      )
    }

    return { 
      user: {
        sub: user.id,
        email: user.email,
        name: user.name || '',
        role: user.role,
        laundryId: user.laundry?.id,
        isSuspended: !!user.suspendedAt,
        suspensionReason: user.suspensionReason || undefined
      }, 
      error: null 
    }
  } catch (error) {
    console.error('Authentication error:', error)
    return NextResponse.json(
      { success: false, message: 'Invalid or expired token' },
      { status: 401 }
    )
  }
}

export async function requireRole(
  request: NextRequest, 
  allowedRoles: string[],
  options?: {
    requireLaundry?: boolean
    allowSuperAdmin?: boolean
  }
): Promise<AuthResult | NextResponse> {
  const authResult = await authenticateUser(request)
  
  if (authResult instanceof NextResponse) {
    return authResult // Erreur d'authentification
  }

  const { user } = authResult

  // Super Admin a accès à tout sauf si explicitement exclu
  if (user.role === 'SUPER_ADMIN' && options?.allowSuperAdmin !== false) {
    return { user, error: null }
  }

  // Vérifier le rôle
  if (!allowedRoles.includes(user.role)) {
    return NextResponse.json(
      { success: false, message: 'Insufficient permissions' },
      { status: 403 }
    )
  }

  // Vérifier que l'admin a une laundry si requis
  if (options?.requireLaundry && user.role === 'ADMIN' && !user.laundryId) {
    return NextResponse.json(
      { success: false, message: 'Admin must be associated with a laundry' },
      { status: 403 }
    )
  }

  return { user, error: null }
}

export async function requireCustomerOwnership(
  request: NextRequest,
  resourceUserId: string
): Promise<AuthResult | NextResponse> {
  const authResult = await requireRole(request, ['CUSTOMER', 'ADMIN', 'SUPER_ADMIN'])
  
  if (authResult instanceof NextResponse) {
    return authResult
  }

  const { user } = authResult

  // Super Admin peut accéder à tout
  if (user.role === 'SUPER_ADMIN') {
    return { user, error: null }
  }

  // Customer peut seulement accéder à ses propres ressources
  if (user.role === 'CUSTOMER' && user.sub !== resourceUserId) {
    return NextResponse.json(
      { success: false, message: 'Access denied: You can only access your own resources' },
      { status: 403 }
    )
  }

  // Admin peut accéder aux ressources des customers de sa laundry
  if (user.role === 'ADMIN') {
    const customerUser = await prisma.user.findUnique({
      where: { id: resourceUserId },
      include: { 
        orders: {
          select: { laundryId: true },
          take: 1
        }
      }
    })

    if (!customerUser) {
      return NextResponse.json(
        { success: false, message: 'Customer not found' },
        { status: 404 }
      )
    }

    // Vérifier que le customer appartient à la laundry de l'admin
    if (customerUser.orders.length > 0 && customerUser.orders[0].laundryId !== user.laundryId) {
      return NextResponse.json(
        { success: false, message: 'Access denied: Customer not associated with your laundry' },
        { status: 403 }
      )
    }
  }

  return { user, error: null }
}

export async function requireLaundryAccess(
  request: NextRequest,
  laundryId: string
): Promise<AuthResult | NextResponse> {
  const authResult = await requireRole(request, ['ADMIN', 'SUPER_ADMIN'])
  
  if (authResult instanceof NextResponse) {
    return authResult
  }

  const { user } = authResult

  // Super Admin peut accéder à toutes les laundries
  if (user.role === 'SUPER_ADMIN') {
    return { user, error: null }
  }

  // Admin peut seulement accéder à sa laundry
  if (user.role === 'ADMIN' && user.laundryId !== laundryId) {
    return NextResponse.json(
      { success: false, message: 'Access denied: You can only access your own laundry' },
      { status: 403 }
    )
  }

  return { user, error: null }
}

export async function requireOrderAccess(
  request: NextRequest,
  orderId: string
): Promise<AuthResult | NextResponse> {
  const authResult = await requireRole(request, ['CUSTOMER', 'ADMIN', 'SUPER_ADMIN'])
  
  if (authResult instanceof NextResponse) {
    return authResult
  }

  const { user } = authResult

  // Super Admin peut accéder à toutes les commandes
  if (user.role === 'SUPER_ADMIN') {
    return { user, error: null }
  }

  // Récupérer la commande
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      customerId: true,
      laundryId: true
    }
  })

  if (!order) {
    return NextResponse.json(
      { success: false, message: 'Order not found' },
      { status: 404 }
    )
  }

  // Customer peut seulement accéder à ses propres commandes
  if (user.role === 'CUSTOMER' && order.customerId !== user.sub) {
    return NextResponse.json(
      { success: false, message: 'Access denied: You can only access your own orders' },
      { status: 403 }
    )
  }

  // Admin peut seulement accéder aux commandes de sa laundry
  if (user.role === 'ADMIN' && order.laundryId !== user.laundryId) {
    return NextResponse.json(
      { success: false, message: 'Access denied: Order not associated with your laundry' },
      { status: 403 }
    )
  }

  return { user, error: null }
}

// Utilitaires de réponse standardisées
export const successResponse = (data: any, message: string = 'Success') => {
  return NextResponse.json({
    success: true,
    message,
    data
  })
}

export const errorResponse = (message: string, status: number = 400) => {
  return NextResponse.json(
    { success: false, message },
    { status }
  )
}
// lib/auth-middleware.ts - Version avec JWT Bearer Token
import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

export async function authenticateUser(request: NextRequest) {
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

    return { 
      user: {
        sub: payload.sub as string,
        email: payload.email as string,
        name: payload.name as string,
        role: payload.role as string
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

export async function requireRole(request: NextRequest, allowedRoles: string[]) {
  const authResult = await authenticateUser(request)
  
  if (authResult instanceof NextResponse) {
    return authResult // Erreur d'authentification
  }

  const { user } = authResult

  if (!allowedRoles.includes(user.role as string)) {
    return NextResponse.json(
      { success: false, message: 'Insufficient permissions' },
      { status: 403 }
    )
  }

  return { user, error: null }
}
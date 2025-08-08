// lib/test-auth-middleware.ts - Middleware de test temporaire
import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

export async function authenticateTestUser(request: NextRequest) {
  try {
    // Récupérer le token depuis les cookies
    const token = request.cookies.get('auth-token')?.value

    if (!token) {
      return NextResponse.json(
        { success: false, message: 'Authentication required' },
        { status: 401 }
      )
    }

    // Vérifier le JWT
    const secret = new TextEncoder().encode(process.env.NEXTAUTH_SECRET!)
    const { payload } = await jwtVerify(token, secret)

    return { 
      user: {
        sub: payload.sub,
        email: payload.email,
        name: payload.name,
        role: payload.role
      }, 
      error: null 
    }
  } catch (error) {
    console.error('Test authentication error:', error)
    return NextResponse.json(
      { success: false, message: 'Authentication failed' },
      { status: 401 }
    )
  }
}

export async function requireTestRole(request: NextRequest, allowedRoles: string[]) {
  const authResult = await authenticateTestUser(request)
  
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
// app/api/auth/signout/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session) {
      return NextResponse.json(
        { success: false, message: 'Not authenticated' },
        { status: 401 }
      )
    }

    // NextAuth gère automatiquement la déconnexion via l'endpoint standard
    // Rediriger vers l'endpoint NextAuth signout
    return NextResponse.redirect(new URL('/api/auth/signout', request.url))

  } catch (error) {
    console.error('Signout error:', error)
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    message: 'To sign out, make a POST request to this endpoint'
  })
}
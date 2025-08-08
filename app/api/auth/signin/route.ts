// app/api/auth/signin/route.ts - Version avec token JWT
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { SignJWT } from 'jose'
import { z } from 'zod'

const signinSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required')
})

// Fonction pour créer un JWT token
async function createJWT(user: any) {
  const secret = new TextEncoder().encode(process.env.NEXTAUTH_SECRET!)
  
  const jwt = await new SignJWT({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 jours
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret)
    
  return jwt
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    // Validation des données
    const parsed = signinSchema.safeParse(body)
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

    const { email, password } = parsed.data

    // Chercher l'utilisateur dans la base de données
    const user = await prisma.user.findUnique({
      where: { email }
    })

    if (!user || !user.password) {
      return NextResponse.json(
        { success: false, message: 'Invalid credentials' },
        { status: 401 }
      )
    }

    // Vérifier le mot de passe
    const isPasswordValid = await bcrypt.compare(password, user.password)

    if (!isPasswordValid) {
      return NextResponse.json(
        { success: false, message: 'Invalid credentials' },
        { status: 401 }
      )
    }

    // Créer le JWT token
    const token = await createJWT(user)

    return NextResponse.json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role
        },
        accessToken: token,
        tokenType: 'Bearer',
        expiresIn: '7d'
      }
    }, { status: 200 })

  } catch (error) {
    console.error('Signin error:', error)
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    )
  }
}

// GET pour afficher les options de connexion disponibles
export async function GET() {
  return NextResponse.json({
    success: true,
    message: 'Available signin options',
    data: {
      providers: [
        {
          id: 'credentials',
          name: 'Email/Password',
          type: 'credentials'
        },
        {
          id: 'google',
          name: 'Google',
          type: 'oauth'
        }
      ]
    }
  })
}
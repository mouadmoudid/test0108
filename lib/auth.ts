// lib/auth.ts
import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import GoogleProvider from 'next-auth/providers/google'
import { PrismaAdapter } from '@next-auth/prisma-adapter'
import { prisma } from './prisma'
import bcrypt from 'bcryptjs'

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: 'jwt',
  },
  providers: [
    // Provider Credentials (Email/Password)
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error('Email and password required')
        }

        // Chercher l'utilisateur dans la base de données
        const user = await prisma.user.findUnique({
          where: {
            email: credentials.email
          }
        })

        if (!user || !user.password) {
          throw new Error('Invalid credentials')
        }

        // Vérifier le mot de passe
        const isPasswordValid = await bcrypt.compare(credentials.password, user.password)

        if (!isPasswordValid) {
          throw new Error('Invalid credentials')
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          image: user.avatar,
        }
      }
    }),

    // Provider Google
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    })
  ],

  callbacks: {
    async jwt({ token, user, account }) {
      // Persister le rôle dans le token JWT
      if (user) {
        token.role = (user as any).role
      }
      return token
    },
    
    async session({ session, token }) {
      // Envoyer les propriétés au client
      if (token) {
        session.user.id = token.sub!
        session.user.role = token.role as string
      }
      return session
    },

    async signIn({ user, account, profile }) {
      // Pour Google OAuth, créer l'utilisateur s'il n'existe pas
      if (account?.provider === 'google') {
        const existingUser = await prisma.user.findUnique({
          where: { email: user.email! }
        })

        if (!existingUser) {
          // Créer un nouvel utilisateur avec Google
          await prisma.user.create({
            data: {
              email: user.email!,
              name: user.name || '',
              image: user.image || '',
              role: 'CUSTOMER', // Rôle par défaut
            }
          })
        }
      }
      return true
    }
  },

  pages: {
    signIn: '/api/auth/signin', // Utiliser l'API directement
    error: '/api/auth/error',
  }
}
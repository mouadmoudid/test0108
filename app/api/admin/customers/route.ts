// app/api/admin/customers/route.ts - Ajouter la méthode POST pour ADMIN uniquement
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import bcrypt from 'bcryptjs'

// Schema pour la création d'un customer
const createCustomerSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(50),
  lastName: z.string().min(1, 'Last name is required').max(50),
  email: z.string().email('Invalid email address'),
  phone: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number').optional(),
  address: z.object({
    street: z.string().min(1, 'Street is required'),
    city: z.string().min(1, 'City is required'),
    state: z.string().min(1, 'State is required'),
    zipCode: z.string().min(1, 'ZIP code is required'),
    country: z.string().optional().default('Morocco')
  }).optional(),
  laundryId: z.string().min(1, 'laundryId is required')
})

// POST /api/admin/customers - ADMIN uniquement
export async function POST(request: NextRequest) {
  // Vérifier que l'utilisateur est ADMIN UNIQUEMENT
  const authResult = await requireRole(request, ['ADMIN'])
  
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
    
    const parsed = createCustomerSchema.safeParse(body)
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

    const { firstName, lastName, email, phone, address, laundryId } = parsed.data

    // Vérifier que l'admin a accès à cette laundry
    const adminUser = await prisma.user.findUnique({
      where: { id: user.sub },
      include: { laundry: true }
    })

    if (!adminUser?.laundry || adminUser.laundry.id !== laundryId) {
      return NextResponse.json(
        { success: false, message: 'Access denied: Admin must be associated with the specified laundry' },
        { status: 403 }
      )
    }

    // Vérifier que l'email n'existe pas déjà
    const existingUser = await prisma.user.findUnique({
      where: { email }
    })

    if (existingUser) {
      return NextResponse.json(
        { success: false, message: 'A user with this email already exists' },
        { status: 409 }
      )
    }

    // Générer un mot de passe temporaire
    const tempPassword = generateTempPassword()
    const hashedPassword = await bcrypt.hash(tempPassword, 12)

    // Créer le customer avec son adresse dans une transaction
    const result = await prisma.$transaction(async (tx) => {
      // Créer l'utilisateur
      const newCustomer = await tx.user.create({
        data: {
          name: `${firstName} ${lastName}`,
          email,
          phone,
          password: hashedPassword,
          role: 'CUSTOMER',
          emailVerified: new Date() // Considéré comme vérifié puisque créé par admin
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          createdAt: true
        }
      })

      // Créer l'adresse par défaut si fournie
      let defaultAddress = null
      if (address) {
        defaultAddress = await tx.address.create({
          data: {
            userId: newCustomer.id,
            street: address.street,
            city: address.city,
            state: address.state,
            zipCode: address.zipCode,
            country: address.country,
            isDefault: true
          },
          select: {
            id: true,
            street: true,
            city: true,
            state: true,
            zipCode: true,
            country: true,
            isDefault: true
          }
        })
      }

      // Créer une activité de log
      await tx.activity.create({
        data: {
          type: 'CUSTOMER_ADDED',
          title: 'Customer Created by Admin',
          description: `New customer ${firstName} ${lastName} was created by admin`,
          laundryId,
          userId: newCustomer.id,
          metadata: {
            createdBy: user.sub,
            createdByRole: user.role,
            customerEmail: email,
            hasAddress: !!address,
            tempPassword: tempPassword // Pour l'envoyer par email (à sécuriser)
          }
        }
      })

      return {
        customer: newCustomer,
        address: defaultAddress,
        tempPassword
      }
    })

    // TODO: Envoyer un email de bienvenue avec le mot de passe temporaire
    // await sendWelcomeEmail(result.customer.email, result.tempPassword)

    const response = {
      customer: {
        ...result.customer,
        address: result.address,
        stats: {
          totalOrders: 0,
          totalSpent: 0,
          averageOrderValue: 0,
          lastOrder: null
        },
        status: 'new',
        segment: 'New'
      },
      credentials: {
        email: result.customer.email,
        tempPassword: result.tempPassword,
        instructions: 'Please share these credentials with the customer. They should change the password on first login.'
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Customer created successfully',
      data: response,
      createdBy: {
        userId: user.sub,
        role: user.role,
        laundryId
      }
    }, { status: 201 })

  } catch (error: any) {
    console.error('Create customer error:', error)
    
    // Handle unique constraint errors
    if (error?.code === 'P2002') {
      return NextResponse.json(
        { success: false, message: 'A user with this email already exists' },
        { status: 409 }
      )
    }
    
    return NextResponse.json(
      { success: false, message: 'Failed to create customer' },
      { status: 500 }
    )
  }
}

// Helper function pour générer un mot de passe temporaire
function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let password = ''
  
  // Assurer qu'il y a au moins une majuscule, une minuscule et un chiffre
  password += chars.charAt(Math.floor(Math.random() * 23)) // Majuscule
  password += chars.charAt(Math.floor(Math.random() * 23) + 26) // Minuscule  
  password += chars.charAt(Math.floor(Math.random() * 8) + 49) // Chiffre
  
  // Compléter avec des caractères aléatoires
  for (let i = 3; i < 8; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  
  // Mélanger les caractères
  return password.split('').sort(() => Math.random() - 0.5).join('')
}

// TODO: Fonction pour envoyer un email de bienvenue
async function sendWelcomeEmail(email: string, tempPassword: string) {
  // Implémenter l'envoi d'email avec un service comme SendGrid, AWS SES, etc.
  console.log(`Welcome email should be sent to ${email} with password: ${tempPassword}`)
  
  // Exemple d'implémentation avec un service d'email:
  /*
  await emailService.send({
    to: email,
    subject: 'Welcome to Our Laundry Service',
    template: 'customer-welcome',
    data: {
      tempPassword,
      loginUrl: `${process.env.FRONTEND_URL}/login`
    }
  })
  */
}
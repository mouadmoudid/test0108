// app/api/admin/customers/route.ts - ADMIN uniquement (Complet)
import { NextRequest, NextResponse } from 'next/server'
import { requireRole, successResponse, errorResponse } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import bcrypt from 'bcryptjs'

// Schema pour la récupération des customers
const customersQuerySchema = z.object({
  page: z.coerce.number().min(1).optional().default(1),
  limit: z.coerce.number().min(1).max(100).optional().default(20),
  search: z.string().optional(),
  segment: z.enum(['ALL', 'Premium', 'Regular', 'Basic', 'New']).optional().default('ALL'),
  sortBy: z.enum(['name', 'email', 'createdAt', 'totalSpent']).optional().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc')
})

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
  }).optional()
  // SUPPRIMÉ: laundryId car il vient automatiquement de l'admin connecté
})

// GET /api/admin/customers - Liste tous les clients de la laundry de l'admin
export async function GET(request: NextRequest) {
  const authResult = await requireRole(request, ['ADMIN'], { requireLaundry: true })
  
  if (authResult instanceof NextResponse) {
    return authResult
  }

  const { user } = authResult

  try {
    const { searchParams } = new URL(request.url)
    const queryParams = Object.fromEntries(searchParams.entries())
    
    const parsed = customersQuerySchema.safeParse(queryParams)
    if (!parsed.success) {
      return errorResponse('Invalid query parameters', 400)
    }

    const { page, limit, search, segment, sortBy, sortOrder } = parsed.data
    const offset = (page - 1) * limit

    // Construire les conditions de filtrage
    const where: any = {
      role: 'CUSTOMER',
      orders: {
        some: {
          laundryId: user.laundryId
        }
      }
    }

    // Ajouter la recherche si spécifiée
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } }
      ]
    }

    // Récupérer les clients avec leurs statistiques
    const [customers, totalCount] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          avatar: true,
          createdAt: true,
          suspendedAt: true,
          suspensionReason: true,
          orders: {
            where: {
              laundryId: user.laundryId,
              status: { in: ['DELIVERED', 'COMPLETED'] }
            },
            select: {
              finalAmount: true,
              createdAt: true
            }
          },
          addresses: {
            select: {
              city: true,
              state: true
            },
            take: 1
          }
        },
        skip: offset,
        take: limit
      }),
      prisma.user.count({ where })
    ])

    // Enrichir les données avec les calculs
    const enrichedCustomers = customers.map(customer => {
      const totalSpent = customer.orders.reduce((sum, order) => sum + order.finalAmount, 0)
      const orderCount = customer.orders.length
      const lastOrderDate = customer.orders.length > 0 
        ? customer.orders.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0].createdAt
        : null

      // Déterminer le segment
      let customerSegment = 'New'
      if (totalSpent >= 1000 && orderCount >= 10) customerSegment = 'Premium'
      else if (totalSpent >= 500 && orderCount >= 5) customerSegment = 'Regular'
      else if (orderCount >= 2) customerSegment = 'Basic'

      // Calculer les jours depuis la dernière commande
      const daysSinceLastOrder = lastOrderDate 
        ? Math.floor((new Date().getTime() - lastOrderDate.getTime()) / (1000 * 60 * 60 * 24))
        : null

      return {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        avatar: customer.avatar,
        location: customer.addresses[0] ? `${customer.addresses[0].city}, ${customer.addresses[0].state}` : 'Non spécifiée',
        
        // Statistiques
        stats: {
          totalOrders: orderCount,
          totalSpent: totalSpent,
          averageOrderValue: orderCount > 0 ? Number((totalSpent / orderCount).toFixed(2)) : 0,
          segment: customerSegment,
          daysSinceLastOrder,
          lastOrderDate
        },

        // Dates
        joinedDate: customer.createdAt,
        
        // Statut
        status: {
          isActive: daysSinceLastOrder === null || daysSinceLastOrder <= 90,
          isSuspended: !!customer.suspendedAt,
          suspensionReason: customer.suspensionReason,
          needsAttention: daysSinceLastOrder !== null && daysSinceLastOrder > 180
        }
      }
    })

    // Filtrer par segment si spécifié
    let filteredCustomers = enrichedCustomers
    if (segment !== 'ALL') {
      filteredCustomers = enrichedCustomers.filter(customer => customer.stats.segment === segment)
    }

    // Trier les résultats
    filteredCustomers.sort((a, b) => {
      let aValue: any, bValue: any
      
      switch (sortBy) {
        case 'name':
          aValue = a.name || ''
          bValue = b.name || ''
          break
        case 'email':
          aValue = a.email
          bValue = b.email
          break
        case 'totalSpent':
          aValue = a.stats.totalSpent
          bValue = b.stats.totalSpent
          break
        default: // createdAt
          aValue = a.joinedDate.getTime()
          bValue = b.joinedDate.getTime()
      }
      
      if (typeof aValue === 'string') {
        return sortOrder === 'desc' 
          ? bValue.localeCompare(aValue)
          : aValue.localeCompare(bValue)
      } else {
        return sortOrder === 'desc' ? bValue - aValue : aValue - bValue
      }
    })

    const totalPages = Math.ceil(totalCount / limit)

    return successResponse({
      customers: filteredCustomers,
      pagination: {
        currentPage: page,
        totalPages,
        totalCount,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1
      },
      summary: {
        totalCustomers: totalCount,
        activeCustomers: filteredCustomers.filter(c => c.status.isActive).length,
        suspendedCustomers: filteredCustomers.filter(c => c.status.isSuspended).length,
        needAttention: filteredCustomers.filter(c => c.status.needsAttention).length
      }
    }, 'Customers retrieved successfully')
  } catch (error) {
    console.error('Get customers error:', error)
    return errorResponse('Failed to retrieve customers', 500)
  }
}

// POST /api/admin/customers - ADMIN uniquement (CORRIGÉ)
export async function POST(request: NextRequest) {
  // Vérifier que l'utilisateur est ADMIN UNIQUEMENT
  const authResult = await requireRole(request, ['ADMIN'], { requireLaundry: true })
  
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

    const { firstName, lastName, email, phone, address } = parsed.data
    // CORRECTION: Utiliser user.laundryId au lieu du paramètre
    const laundryId = user.laundryId!

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
          userId: user.sub,
          metadata: {
            createdBy: user.sub,
            createdByRole: user.role,
            customerEmail: email,
            hasAddress: !!address,
            laundryId: laundryId
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
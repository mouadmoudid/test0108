// app/api/admin/customers/overview/route.ts - ADMIN uniquement (CORRIGÉ - Sans SQL brut)
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const querySchema = z.object({
  timeframe: z.enum(['week', 'month', 'quarter', 'year']).optional().default('month')
})

export async function GET(request: NextRequest) {
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

  // Vérifier que l'admin a un laundryId
  if (!user.laundryId) {
    return NextResponse.json(
      { success: false, message: 'Admin must be associated with a laundry' },
      { status: 403 }
    )
  }

  try {
    const { searchParams } = new URL(request.url)
    const queryParams = Object.fromEntries(searchParams.entries())
    
    const parsed = querySchema.safeParse(queryParams)
    if (!parsed.success) {
      return NextResponse.json(
        { 
          success: false, 
          message: 'Invalid query parameters', 
          errors: parsed.error.errors 
        },
        { status: 400 }
      )
    }

    const { timeframe } = parsed.data
    const laundryId = user.laundryId // Utiliser le laundryId de l'admin connecté

    // Calculer les dates pour la période
    const now = new Date()
    let startDate: Date
    let previousStartDate: Date

    switch (timeframe) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        previousStartDate = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
        break
      case 'quarter':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
        previousStartDate = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000)
        break
      case 'year':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
        previousStartDate = new Date(now.getTime() - 730 * 24 * 60 * 60 * 1000)
        break
      default: // month
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        previousStartDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)
    }

    // Métriques actuelles
    const [
      totalCustomers,
      activeCustomers,
      newCustomers,
      previousNewCustomers,
      ltv
    ] = await Promise.all([
      // Total clients ayant commandé dans cette laundry
      prisma.user.count({
        where: {
          role: 'CUSTOMER',
          orders: {
            some: {
              laundryId: laundryId
            }
          }
        }
      }),

      // Clients actifs (ayant commandé dans la période)
      prisma.user.count({
        where: {
          role: 'CUSTOMER',
          orders: {
            some: {
              laundryId: laundryId,
              createdAt: { gte: startDate }
            }
          }
        }
      }),

      // Nouveaux clients de la période
      prisma.user.count({
        where: {
          role: 'CUSTOMER',
          createdAt: { gte: startDate },
          orders: {
            some: {
              laundryId: laundryId
            }
          }
        }
      }),

      // Nouveaux clients de la période précédente
      prisma.user.count({
        where: {
          role: 'CUSTOMER',
          createdAt: { 
            gte: previousStartDate,
            lt: startDate 
          },
          orders: {
            some: {
              laundryId: laundryId
            }
          }
        }
      }),

      // Calculer LTV (Customer Lifetime Value) moyen
      prisma.order.aggregate({
        where: {
          laundryId: laundryId,
          status: { in: ['DELIVERED', 'COMPLETED'] }
        },
        _avg: { finalAmount: true }
      })
    ])

    // Données pour "Customer Growth" (7 derniers points)
    const customerGrowth = await Promise.all(
      Array.from({ length: 7 }, async (_, i) => {
        const date = new Date(startDate.getTime() + (i * (now.getTime() - startDate.getTime()) / 7))
        const nextDate = new Date(startDate.getTime() + ((i + 1) * (now.getTime() - startDate.getTime()) / 7))
        
        const count = await prisma.user.count({
          where: {
            role: 'CUSTOMER',
            createdAt: {
              gte: date,
              lt: nextDate
            },
            orders: {
              some: {
                laundryId: laundryId
              }
            }
          }
        })
        
        return {
          date: date.toISOString().split('T')[0],
          newCustomers: count
        }
      })
    )

    // Calculer la segmentation des clients sans SQL brut
    // Récupérer tous les clients avec leurs totaux de dépenses
    const customersWithSpending = await prisma.user.findMany({
      where: {
        role: 'CUSTOMER',
        orders: {
          some: {
            laundryId: laundryId
          }
        }
      },
      include: {
        orders: {
          where: {
            laundryId: laundryId,
            status: { in: ['DELIVERED', 'COMPLETED'] }
          },
          select: {
            finalAmount: true
          }
        }
      }
    })

    // Calculer les segments manuellement
    let premiumCount = 0
    let regularCount = 0
    let basicCount = 0

    customersWithSpending.forEach(customer => {
      const totalSpent = customer.orders.reduce((sum, order) => sum + order.finalAmount, 0)
      
      if (totalSpent >= 1000) {
        premiumCount++
      } else if (totalSpent >= 500) {
        regularCount++
      } else {
        basicCount++
      }
    })

    // Fonction pour calculer la croissance
    const calculateGrowth = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? 100 : 0
      return Number(((current - previous) / previous * 100).toFixed(1))
    }

    const overview = {
      // Métriques principales
      metrics: {
        totalCustomers: {
          value: totalCustomers,
          label: 'Total Clients'
        },
        activeCustomers: {
          value: activeCustomers,
          percentage: totalCustomers > 0 ? Math.round((activeCustomers / totalCustomers) * 100) : 0,
          label: `Clients Actifs (${timeframe})`
        },
        newCustomers: {
          value: newCustomers,
          growth: calculateGrowth(newCustomers, previousNewCustomers),
          label: `Nouveaux Clients (${timeframe})`
        },
        ltv: {
          value: Number((ltv._avg.finalAmount || 0).toFixed(2)),
          label: 'LTV Moyen'
        }
      },

      // Données pour les graphiques
      charts: {
        customerGrowth: customerGrowth,
        customerSegments: [
          { 
            segment: 'Premium', 
            count: premiumCount, 
            percentage: totalCustomers > 0 ? Math.round((premiumCount / totalCustomers) * 100) : 0 
          },
          { 
            segment: 'Régulier', 
            count: regularCount, 
            percentage: totalCustomers > 0 ? Math.round((regularCount / totalCustomers) * 100) : 0 
          },
          { 
            segment: 'Basique', 
            count: basicCount, 
            percentage: totalCustomers > 0 ? Math.round((basicCount / totalCustomers) * 100) : 0 
          }
        ]
      },

      // Informations contextuelles
      context: {
        timeframe,
        periodStart: startDate,
        periodEnd: now,
        laundryId: laundryId
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Customer overview retrieved successfully',
      data: overview
    })
  } catch (error) {
    console.error('Customer overview error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to retrieve customer overview' },
      { status: 500 }
    )
  }
}
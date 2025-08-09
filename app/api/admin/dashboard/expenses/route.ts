// app/api/admin/dashboard/expenses/route.ts - ADMIN uniquement
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole, successResponse, errorResponse } from '@/lib/auth-middleware'
import { z } from 'zod'

const expensesQuerySchema = z.object({
  timeframe: z.enum(['week', 'month', 'quarter', 'year']).optional().default('month')
})

export async function GET(request: NextRequest) {
  const authResult = await requireRole(request, ['ADMIN'], { requireLaundry: true })
  
  if (authResult instanceof NextResponse) {
    return authResult
  }

  const { user } = authResult

  try {
    const { searchParams } = new URL(request.url)
    const queryParams = Object.fromEntries(searchParams.entries())
    
    const parsed = expensesQuerySchema.safeParse(queryParams)
    if (!parsed.success) {
      return errorResponse('Invalid query parameters')
    }

    const { timeframe } = parsed.data

    // Calculer les dates pour la période
    const now = new Date()
    let startDate: Date

    switch (timeframe) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        break
      case 'quarter':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
        break
      case 'year':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
        break
      default: // month
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    }

    // Pour cet exemple, nous simulons les dépenses
    // Dans un vrai système, vous auriez une table `expenses` ou similaire
    const mockExpenses = {
      totalExpenses: 25000,
      breakdown: [
        { category: 'Salaires', amount: 15000, percentage: 60 },
        { category: 'Électricité', amount: 3000, percentage: 12 },
        { category: 'Produits chimiques', amount: 2500, percentage: 10 },
        { category: 'Maintenance', amount: 2000, percentage: 8 },
        { category: 'Marketing', amount: 1500, percentage: 6 },
        { category: 'Autres', amount: 1000, percentage: 4 }
      ],
      timeline: [
        { date: new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000), amount: 850 },
        { date: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000), amount: 920 },
        { date: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000), amount: 780 },
        { date: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000), amount: 1100 },
        { date: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), amount: 950 },
        { date: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000), amount: 1050 },
        { date: now, amount: 900 }
      ]
    }

    return successResponse(mockExpenses, 'Expenses data retrieved successfully')
  } catch (error) {
    console.error('Expenses error:', error)
    return errorResponse('Failed to retrieve expenses data', 500)
  }
}

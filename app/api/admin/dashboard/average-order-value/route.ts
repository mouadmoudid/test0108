// app/api/admin/dashboard/average-order-value/route.ts - ADMIN uniquement
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const querySchema = z.object({
  timeframe: z.enum(['week', 'month', 'year']).optional().default('month'),
  laundryId: z.string().min(1, 'laundryId is required')
})

export async function GET(request: NextRequest) {
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

    const { timeframe, laundryId } = parsed.data

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

    // Calculer les dates selon le timeframe
    const now = new Date()
    let startDate: Date
    let periods: number

    switch (timeframe) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        periods = 7
        break
      case 'month':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        periods = 30
        break
      case 'year':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
        periods = 12
        break
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        periods = 30
    }

    // Récupérer toutes les commandes dans la période
    const orders = await prisma.order.findMany({
      where: {
        laundryId,
        status: { in: ['DELIVERED', 'COMPLETED'] },
        createdAt: {
          gte: startDate
        }
      },
      include: {
        orderItems: {
          include: {
            product: {
              select: {
                category: true
              }
            }
          }
        },
        customer: {
          select: {
            id: true
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    })

    // Calculer l'AOV actuel
    const totalRevenue = orders.reduce((sum, order) => sum + order.finalAmount, 0)
    const totalOrders = orders.length
    const currentAOV = totalOrders > 0 ? totalRevenue / totalOrders : 0

    // Données de tendance par période
    let trendData: any[] = []
    
    if (timeframe === 'year') {
      // Par mois pour l'année
      for (let i = 11; i >= 0; i--) {
        const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1)
        const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0)
        
        const monthOrders = orders.filter(order => 
          order.createdAt >= monthStart && order.createdAt <= monthEnd
        )
        
        const monthRevenue = monthOrders.reduce((sum, order) => sum + order.finalAmount, 0)
        const monthAOV = monthOrders.length > 0 ? monthRevenue / monthOrders.length : 0
        
        trendData.push({
          period: monthStart.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          aov: Math.round(monthAOV * 100) / 100,
          orders: monthOrders.length,
          revenue: Math.round(monthRevenue * 100) / 100
        })
      }
    } else {
      // Par jour pour semaine/mois
      const daysToShow = timeframe === 'week' ? 7 : 30
      
      for (let i = daysToShow - 1; i >= 0; i--) {
        const dayStart = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
        dayStart.setHours(0, 0, 0, 0)
        const dayEnd = new Date(dayStart)
        dayEnd.setHours(23, 59, 59, 999)
        
        const dayOrders = orders.filter(order => 
          order.createdAt >= dayStart && order.createdAt <= dayEnd
        )
        
        const dayRevenue = dayOrders.reduce((sum, order) => sum + order.finalAmount, 0)
        const dayAOV = dayOrders.length > 0 ? dayRevenue / dayOrders.length : 0
        
        trendData.push({
          period: dayStart.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric',
            ...(timeframe === 'month' ? {} : { weekday: 'short' })
          }),
          aov: Math.round(dayAOV * 100) / 100,
          orders: dayOrders.length,
          revenue: Math.round(dayRevenue * 100) / 100
        })
      }
    }

    // AOV par catégorie de service
    const categoryAOV = orders.reduce((acc: Record<string, {orders: number, revenue: number}>, order) => {
      const categories = Array.from(new Set(order.orderItems.map(item => item.product.category)))
      const primaryCategory = categories[0] || 'General'
      
      if (!acc[primaryCategory]) {
        acc[primaryCategory] = { orders: 0, revenue: 0 }
      }
      
      acc[primaryCategory].orders += 1
      acc[primaryCategory].revenue += order.finalAmount
      
      return acc
    }, {})

    const categoryAnalysis = Object.entries(categoryAOV).map(([category, data]) => ({
      category,
      aov: Math.round((data.revenue / data.orders) * 100) / 100,
      orders: data.orders,
      revenue: Math.round(data.revenue * 100) / 100,
      percentage: Math.round((data.orders / totalOrders) * 100)
    })).sort((a, b) => b.aov - a.aov)

    // AOV par segment de client (basé sur le nombre de commandes)
    const customerSegments = orders.reduce((acc: Record<string, Set<string>>, order) => {
      const customerId = order.customer.id
      const customerOrderCount = orders.filter(o => o.customer.id === customerId).length
      
      let segment: string
      if (customerOrderCount === 1) segment = 'New'
      else if (customerOrderCount <= 3) segment = 'Regular'
      else if (customerOrderCount <= 10) segment = 'Loyal'
      else segment = 'VIP'
      
      if (!acc[segment]) acc[segment] = new Set()
      acc[segment].add(customerId)
      
      return acc
    }, {})

    const segmentAnalysis = Object.entries(customerSegments).map(([segment, customerIds]) => {
      const segmentOrders = orders.filter(order => customerIds.has(order.customer.id))
      const segmentRevenue = segmentOrders.reduce((sum, order) => sum + order.finalAmount, 0)
      const segmentAOV = segmentOrders.length > 0 ? segmentRevenue / segmentOrders.length : 0
      
      return {
        segment,
        aov: Math.round(segmentAOV * 100) / 100,
        customers: customerIds.size,
        orders: segmentOrders.length,
        revenue: Math.round(segmentRevenue * 100) / 100
      }
    }).sort((a, b) => b.aov - a.aov)

    // Calculer la croissance AOV (comparer avec période précédente)
    const previousStartDate = new Date(startDate.getTime() - (now.getTime() - startDate.getTime()))
    const previousOrders = await prisma.order.findMany({
      where: {
        laundryId,
        status: { in: ['DELIVERED', 'COMPLETED'] },
        createdAt: {
          gte: previousStartDate,
          lt: startDate
        }
      }
    })

    const previousRevenue = previousOrders.reduce((sum, order) => sum + order.finalAmount, 0)
    const previousAOV = previousOrders.length > 0 ? previousRevenue / previousOrders.length : 0
    const aovGrowth = previousAOV > 0 ? ((currentAOV - previousAOV) / previousAOV) * 100 : 0

    const response = {
      laundryId,
      timeframe,
      period: {
        startDate: startDate.toISOString(),
        endDate: now.toISOString()
      },
      
      // Métriques principales
      metrics: {
        currentAOV: Math.round(currentAOV * 100) / 100,
        totalOrders,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        aovGrowth: Math.round(aovGrowth * 100) / 100,
        previousAOV: Math.round(previousAOV * 100) / 100
      },
      
      // Données de tendance
      trendData,
      
      // Analyses
      analysis: {
        byCategory: categoryAnalysis,
        byCustomerSegment: segmentAnalysis,
        insights: generateAOVInsights(currentAOV, aovGrowth, categoryAnalysis, segmentAnalysis)
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Average order value data retrieved successfully',
      data: response,
      requestedBy: {
        userId: user.sub,
        role: user.role,
        laundryId
      }
    })

  } catch (error) {
    console.error('Average order value error:', error)
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Helper function pour générer des insights
function generateAOVInsights(currentAOV: number, growth: number, categoryAnalysis: any[], segmentAnalysis: any[]): string[] {
  const insights: string[] = []
  
  if (growth > 5) {
    insights.push(`AOV increased by ${growth.toFixed(1)}% - excellent growth!`)
  } else if (growth < -5) {
    insights.push(`AOV decreased by ${Math.abs(growth).toFixed(1)}% - consider promotional strategies`)
  }
  
  const topCategory = categoryAnalysis[0]
  if (topCategory) {
    insights.push(`${topCategory.category} services have the highest AOV at ${topCategory.aov}`)
  }
  
  const vipSegment = segmentAnalysis.find(s => s.segment === 'VIP')
  if (vipSegment && vipSegment.aov > currentAOV * 1.5) {
    insights.push(`VIP customers have ${((vipSegment.aov / currentAOV - 1) * 100).toFixed(0)}% higher AOV`)
  }
  
  return insights
}
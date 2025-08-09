// app/api/admin/products/overview/route.ts - ADMIN uniquement (CORRIGÉ)
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const querySchema = z.object({
  timeframe: z.enum(['week', 'month', 'quarter', 'year']).optional().default('month')
  // SUPPRIMÉ: laundryId car il vient automatiquement de l'admin connecté
})

export async function GET(request: NextRequest) {
  // Vérifier que l'utilisateur est ADMIN avec laundry associée
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
    const laundryId = user.laundryId // CORRECTION: Utiliser le laundryId de l'admin connecté

    // Calculer les dates selon le timeframe
    const now = new Date()
    let startDate: Date

    switch (timeframe) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        break
      case 'month':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        break
      case 'quarter':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
        break
      case 'year':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
        break
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    }

    // Récupérer tous les produits et leurs statistiques
    const [
      allProducts,
      orderItems,
      recentOrderItems,
      laundryInfo
    ] = await Promise.all([
      // Tous les produits de cette laundry
      prisma.product.findMany({
        where: { laundryId },
        select: {
          id: true,
          name: true,
          description: true,
          price: true,
          category: true,
          unit: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              orderItems: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),

      // Tous les order items pour calculer les revenus
      prisma.orderItem.findMany({
        where: {
          product: { laundryId },
          order: {
            status: { in: ['DELIVERED', 'COMPLETED'] }
          }
        },
        select: {
          id: true,
          productId: true,
          quantity: true,
          price: true,
          totalPrice: true,
          order: {
            select: {
              createdAt: true,
              status: true
            }
          }
        }
      }),

      // Order items de la période récente
      prisma.orderItem.findMany({
        where: {
          product: { laundryId },
          order: {
            status: { in: ['DELIVERED', 'COMPLETED'] },
            createdAt: { gte: startDate }
          }
        },
        select: {
          id: true,
          productId: true,
          quantity: true,
          price: true,
          totalPrice: true,
          order: {
            select: {
              createdAt: true,
              customerId: true
            }
          }
        }
      }),

      // Infos de la laundry
      prisma.laundry.findUnique({
        where: { id: laundryId },
        select: {
          name: true,
          createdAt: true
        }
      })
    ])

    // Calculer les métriques principales
    const totalProducts = allProducts.length
    const activeProducts = allProducts.filter(p => p.isActive !== false).length
    const inactiveProducts = totalProducts - activeProducts

    // Calculer le revenu total par produit
    const productRevenue = orderItems.reduce((acc: Record<string, {
      revenue: number,
      orders: number,
      quantity: number,
      averagePrice: number
    }>, item) => {
      if (!acc[item.productId]) {
        acc[item.productId] = { revenue: 0, orders: 0, quantity: 0, averagePrice: 0 }
      }
      acc[item.productId].revenue += item.totalPrice
      acc[item.productId].orders += 1
      acc[item.productId].quantity += item.quantity
      return acc
    }, {})

    // Calculer les prix moyens
    Object.keys(productRevenue).forEach(productId => {
      const data = productRevenue[productId]
      data.averagePrice = data.quantity > 0 ? data.revenue / data.quantity : 0
    })

    const totalRevenue = Object.values(productRevenue).reduce((sum, data) => sum + data.revenue, 0)
    const totalOrderItems = Object.values(productRevenue).reduce((sum, data) => sum + data.orders, 0)

    // Revenu de la période récente
    const recentRevenue = recentOrderItems.reduce((sum, item) => sum + item.totalPrice, 0)
    const recentOrders = recentOrderItems.length

    const topProducts = allProducts
      .map(product => {
        const stats = productRevenue[product.id] || { revenue: 0, orders: 0, quantity: 0, averagePrice: 0 }
        const recentStats = recentOrderItems
          .filter(item => item.productId === product.id)
          .reduce((acc, item) => {
            acc.customers.add(item.order.customerId)
            return {
              revenue: acc.revenue + item.totalPrice,
              orders: acc.orders + 1,
              quantity: acc.quantity + item.quantity,
              customers: acc.customers
            }
          }, { revenue: 0, orders: 0, quantity: 0, customers: new Set<string>() })

        return {
          id: product.id,
          name: product.name,
          category: product.category,
          price: product.price,
          unit: product.unit,
          isActive: product.isActive,
          
          // Statistiques globales
          stats: {
            totalRevenue: stats.revenue,
            totalOrders: stats.orders,
            totalQuantity: stats.quantity,
            averagePrice: stats.averagePrice
          },
          
          // Statistiques de la période
          recentStats: {
            revenue: recentStats.revenue,
            orders: recentStats.orders,
            quantity: recentStats.quantity,
            uniqueCustomers: recentStats.customers.size,
            revenuePercentage: totalRevenue > 0 ? (recentStats.revenue / totalRevenue) * 100 : 0
          },

          performance: {
            popularityScore: stats.orders + (stats.revenue / 100), // Score basé sur commandes et revenu
            profitabilityScore: stats.revenue / Math.max(stats.orders, 1), // Revenu moyen par commande
            recentTrend: recentStats.orders > 0 ? 'up' : stats.orders > 0 ? 'stable' : 'down'
          }
        }
      })
      .sort((a: any, b: any) => b.performance.popularityScore - a.performance.popularityScore)

    // Performance par catégorie
    const categoryPerformance = allProducts.reduce((acc: Record<string, {
      products: number,
      revenue: number,
      orders: number,
      averagePrice: number
    }>, product) => {
      const category = product.category || 'Other'
      const stats = productRevenue[product.id] || { revenue: 0, orders: 0, quantity: 0, averagePrice: 0 }
      
      if (!acc[category]) {
        acc[category] = { products: 0, revenue: 0, orders: 0, averagePrice: 0 }
      }
      
      acc[category].products += 1
      acc[category].revenue += stats.revenue
      acc[category].orders += stats.orders
      
      return acc
    }, {})

    // Calculer les prix moyens par catégorie
    Object.keys(categoryPerformance).forEach(category => {
      const data = categoryPerformance[category]
      data.averagePrice = data.orders > 0 ? data.revenue / data.orders : 0
    })

    // Tendances mensuelles
    const monthlyTrends: any[] = []
    const monthsToShow = timeframe === 'year' ? 12 : 6
    
    for (let i = monthsToShow - 1; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0)
      
      const monthItems = orderItems.filter(item => 
        item.order.createdAt >= monthStart && item.order.createdAt <= monthEnd
      )
      
      const monthRevenue = monthItems.reduce((sum, item) => sum + item.totalPrice, 0)
      const monthQuantity = monthItems.reduce((sum, item) => sum + item.quantity, 0)
      
      monthlyTrends.push({
        month: monthStart.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        revenue: Math.round(monthRevenue * 100) / 100,
        orders: monthItems.length,
        quantity: monthQuantity,
        averageOrderValue: monthItems.length > 0 ? Math.round((monthRevenue / monthItems.length) * 100) / 100 : 0,
        date: monthStart.toISOString()
      })
    }

    const response = {
      laundryId,
      laundryName: laundryInfo?.name,
      timeframe,
      period: {
        startDate: startDate.toISOString(),
        endDate: now.toISOString()
      },
      
      // Métriques principales
      metrics: {
        totalProducts,
        activeProducts,
        inactiveProducts,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        recentRevenue: Math.round(recentRevenue * 100) / 100,
        averageProductPrice: allProducts.length > 0 
          ? Math.round((allProducts.reduce((sum, p) => sum + p.price, 0) / allProducts.length) * 100) / 100 
          : 0,
        bestSellingProduct: topProducts[0]?.name || 'N/A',
        topRevenueProduct: topProducts.sort((a, b) => b.stats.totalRevenue - a.stats.totalRevenue)[0]?.name || 'N/A'
      },
      
      // Top products (limité à 10)
      topProducts: topProducts.slice(0, 10),
      
      // Performance par catégorie
      categoryAnalysis: Object.entries(categoryPerformance).map(([category, data]) => ({
        category,
        ...data,
        revenue: Math.round(data.revenue * 100) / 100,
        averagePrice: Math.round(data.averagePrice * 100) / 100,
        marketShare: totalRevenue > 0 ? Math.round((data.revenue / totalRevenue) * 100) : 0
      })).sort((a: any, b: any) => b.revenue - a.revenue),
      
      // Tendances mensuelles
      trends: monthlyTrends,
      
      // Insights et recommandations
      insights: generateProductInsights(topProducts, categoryPerformance, totalProducts, activeProducts)
    }

    return NextResponse.json({
      success: true,
      message: 'Products overview data retrieved successfully',
      data: response,
      requestedBy: {
        userId: user.sub,
        role: user.role,
        laundryId
      }
    })

  } catch (error) {
    console.error('Products overview error:', error)
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Helper function pour générer des insights
function generateProductInsights(
  topProducts: any[],
  categoryPerformance: Record<string, any>,
  totalProducts: number,
  activeProducts: number
): string[] {
  const insights: string[] = []
  
  // Product portfolio insights
  if (activeProducts < totalProducts * 0.8) {
    insights.push(`${totalProducts - activeProducts} products are inactive - consider reviewing or removing them`)
  }
  
  // Best performer insights
  if (topProducts.length > 0) {
    const bestProduct = topProducts[0]
    insights.push(`"${bestProduct.name}" is your top performer with ${bestProduct.stats.totalOrders} orders`)
    
    if (bestProduct.recentStats.revenuePercentage > 30) {
      insights.push(`Heavy dependency on "${bestProduct.name}" (${bestProduct.recentStats.revenuePercentage.toFixed(0)}% of revenue)`)
    }
  }
  
  // Category insights
  const categories = Object.entries(categoryPerformance).sort((a, b) => b[1].revenue - a[1].revenue)
  if (categories.length > 0) {
    const topCategory = categories[0]
    insights.push(`"${topCategory[0]}" category generates the most revenue with ${topCategory[1].products} products`)
  }
  
  // Underperforming products
  const underperformers = topProducts.filter(p => p.performance.recentTrend === 'down').length
  if (underperformers > 0) {
    insights.push(`${underperformers} products showing declining performance - review pricing or marketing`)
  }
  
  // Pricing insights
  const pricingVariance = topProducts.reduce((acc: number[], p: any) => {
    acc.push(p.price)
    return acc
  }, [])
  
  if (pricingVariance.length > 1) {
    const avgPrice = pricingVariance.reduce((a: number, b: number) => a + b, 0) / pricingVariance.length
    const highPriced = pricingVariance.filter((p: number) => p > avgPrice * 1.5).length
    if (highPriced > 0) {
      insights.push(`${highPriced} premium-priced products - monitor demand sensitivity`)
    }
  }
  
  return insights
}
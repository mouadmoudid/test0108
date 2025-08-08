// app/api/admin/dashboard/expenses/route.ts
import { prisma } from '@/lib/prisma'
import { successResponse, errorResponse } from '@/lib/response'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const timeframe = searchParams.get('timeframe') || 'month'
    const laundryId = searchParams.get('laundryId')

    if (!laundryId) {
      return errorResponse('laundryId parameter is required', 400)
    }

    // Verify laundry exists
    const laundry = await prisma.laundry.findUnique({
      where: { id: laundryId }
    })

    if (!laundry) {
      return errorResponse('Laundry not found', 404)
    }

    // Calculate date range based on timeframe
    const now = new Date()
    let startDate: Date
    
    switch (timeframe) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        break
      case 'month':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        break
      case 'year':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
        break
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    }

    // Since there's no expenses table in the schema, we'll simulate expenses based on business logic
    // In a real implementation, you'd have an expenses table
    
    // Get orders for calculating delivery costs
    const orders = await prisma.order.findMany({
      where: {
        laundryId,
        createdAt: {
          gte: startDate
        }
      }
    })

    // Calculate simulated expenses
    const totalRevenue = orders.reduce((sum, order) => sum + order.finalAmount, 0)
    const totalDeliveryFees = orders.reduce((sum, order) => sum + (order.deliveryFee || 0), 0)
    
    // Simulate different expense categories as percentages of revenue
    const operatingExpenses = totalRevenue * 0.35 // 35% of revenue
    const staffCosts = totalRevenue * 0.25 // 25% of revenue
    const utilitiesCosts = totalRevenue * 0.08 // 8% of revenue
    const suppliesCosts = totalRevenue * 0.15 // 15% of revenue
    const maintenanceCosts = totalRevenue * 0.05 // 5% of revenue
    const marketingCosts = totalRevenue * 0.03 // 3% of revenue
    const otherExpenses = totalRevenue * 0.02 // 2% of revenue

    const totalExpenses = operatingExpenses + staffCosts + utilitiesCosts + 
                         suppliesCosts + maintenanceCosts + marketingCosts + otherExpenses

    // Expense breakdown
    const expenseBreakdown = [
      {
        category: 'Operating',
        amount: operatingExpenses,
        percentage: 35,
        description: 'Rent, insurance, and general operations'
      },
      {
        category: 'Staff',
        amount: staffCosts,
        percentage: 25,
        description: 'Salaries and employee benefits'
      },
      {
        category: 'Supplies',
        amount: suppliesCosts,
        percentage: 15,
        description: 'Detergents, cleaning materials, packaging'
      },
      {
        category: 'Utilities',
        amount: utilitiesCosts,
        percentage: 8,
        description: 'Electricity, water, gas'
      },
      {
        category: 'Maintenance',
        amount: maintenanceCosts,
        percentage: 5,
        description: 'Equipment maintenance and repairs'
      },
      {
        category: 'Marketing',
        amount: marketingCosts,
        percentage: 3,
        description: 'Advertising and promotional activities'
      },
      {
        category: 'Other',
        amount: otherExpenses,
        percentage: 2,
        description: 'Miscellaneous expenses'
      }
    ]

    // Generate expense trend data
    const expenseTrendData = []
    const periodsToShow = timeframe === 'year' ? 12 : timeframe === 'month' ? 4 : 7
    const periodLength = timeframe === 'year' ? 30 : timeframe === 'month' ? 7 : 1
    
    for (let i = periodsToShow - 1; i >= 0; i--) {
      const periodStart = new Date(now.getTime() - (i + 1) * periodLength * 24 * 60 * 60 * 1000)
      const periodEnd = new Date(now.getTime() - i * periodLength * 24 * 60 * 60 * 1000)
      
      const periodOrders = await prisma.order.findMany({
        where: {
          laundryId,
          createdAt: {
            gte: periodStart,
            lte: periodEnd
          }
        }
      })
      
      const periodRevenue = periodOrders.reduce((sum, order) => sum + order.finalAmount, 0)
      const periodExpenses = periodRevenue * 0.93 // 93% of revenue as total expenses
      
      let periodLabel: string
      if (timeframe === 'year') {
        periodLabel = periodStart.toLocaleDateString('en-US', { month: 'short' })
      } else if (timeframe === 'month') {
        periodLabel = `Week ${periodsToShow - i}`
      } else {
        periodLabel = periodStart.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
      }
      
      expenseTrendData.push({
        period: periodLabel,
        expenses: periodExpenses,
        revenue: periodRevenue,
        profit: periodRevenue - periodExpenses
      })
    }

    const response = {
      // Summary
      summary: {
        totalExpenses,
        totalRevenue,
        netProfit: totalRevenue - totalExpenses,
        profitMargin: totalRevenue > 0 ? ((totalRevenue - totalExpenses) / totalRevenue) * 100 : 0,
        expenseRatio: totalRevenue > 0 ? (totalExpenses / totalRevenue) * 100 : 0
      },
      
      // Detailed breakdown
      breakdown: expenseBreakdown,
      
      // Trend data
      trends: expenseTrendData,
      
      // Period info
      period: {
        timeframe,
        startDate: startDate.toISOString(),
        endDate: now.toISOString()
      }
    }

    return successResponse(response, 'Expense data retrieved successfully')
  } catch (error) {
    console.error('Dashboard expenses error:', error)
    return errorResponse('Failed to retrieve expense data', 500)
  }
}
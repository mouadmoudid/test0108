// app/api/admin/products/export/route.ts
import { prisma } from '@/lib/prisma'
import { errorResponse } from '@/lib/response'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const laundryId = searchParams.get('laundryId')
    const format = searchParams.get('format') || 'csv'

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

    // Build where conditions
    const whereConditions: any = { laundryId }

    // Get products with statistics
    const products = await prisma.product.findMany({
      where: whereConditions,
      include: {
        orderItems: {
          include: {
            order: {
              select: {
                status: true,
                createdAt: true
              }
            }
          }
        }
      },
      orderBy: { name: 'asc' }
    })

    // Calculate statistics for each product
    const productsWithStats = products.map(product => {
      const completedOrderItems = product.orderItems.filter(item => 
        ['COMPLETED', 'DELIVERED'].includes(item.order.status)
      )
      
      const totalQuantitySold = completedOrderItems.reduce((sum, item) => sum + item.quantity, 0)
      const totalRevenue = completedOrderItems.reduce((sum, item) => sum + item.totalPrice, 0)
      const totalOrders = new Set(completedOrderItems.map(item => item.orderId)).size

      return {
        id: product.id,
        name: product.name,
        description: product.description || '',
        price: product.price,
        category: product.category || '',
        unit: product.unit,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
        totalQuantitySold,
        totalRevenue,
        totalOrders,
        averageOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0
      }
    })

    if (format === 'csv') {
      // Generate CSV content
      const csvHeaders = [
        'ID',
        'Name',
        'Description',
        'Price',
        'Category',
        'Unit',
        'Total Quantity Sold',
        'Total Revenue',
        'Total Orders',
        'Average Order Value',
        'Created Date',
        'Updated Date'
      ]

      const csvRows = productsWithStats.map(product => [
        product.id,
        `"${product.name.replace(/"/g, '""')}"`, // Escape quotes
        `"${product.description.replace(/"/g, '""')}"`,
        product.price.toString(),
        `"${product.category.replace(/"/g, '""')}"`,
        product.unit,
        product.totalQuantitySold.toString(),
        product.totalRevenue.toFixed(2),
        product.totalOrders.toString(),
        product.averageOrderValue.toFixed(2),
        product.createdAt.toISOString().split('T')[0],
        product.updatedAt.toISOString().split('T')[0]
      ])

      const csvContent = [
        csvHeaders.join(','),
        ...csvRows.map(row => row.join(','))
      ].join('\n')

      // Generate filename with timestamp
      const timestamp = new Date().toISOString().split('T')[0]
      const filename = `products_export_${timestamp}.csv`

      return new Response(csvContent, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-cache'
        }
      })
    } else if (format === 'json') {
      // Generate JSON content
      const jsonContent = {
        exportDate: new Date().toISOString(),
        laundryId,
        totalProducts: productsWithStats.length,
        products: productsWithStats
      }

      const timestamp = new Date().toISOString().split('T')[0]
      const filename = `products_export_${timestamp}.json`

      return new Response(JSON.stringify(jsonContent, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-cache'
        }
      })
    } else {
      return errorResponse('Invalid format. Supported formats: csv, json', 400)
    }

  } catch (error) {
    console.error('Export products error:', error)
    return errorResponse('Failed to export products', 500)
  }
}
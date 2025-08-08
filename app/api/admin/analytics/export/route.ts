// app/api/admin/analytics/export/route.ts
import { prisma } from '@/lib/prisma'
import { errorResponse } from '@/lib/response'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const laundryId = searchParams.get('laundryId')
    const startDateStr = searchParams.get('startDate')
    const endDateStr = searchParams.get('endDate')
    const format = searchParams.get('format') || 'excel'

    if (!laundryId) {
      return errorResponse('laundryId parameter is required', 400)
    }

    if (!startDateStr || !endDateStr) {
      return errorResponse('startDate and endDate parameters are required', 400)
    }

    const startDate = new Date(startDateStr)
    const endDate = new Date(endDateStr)

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return errorResponse('Invalid date format', 400)
    }

    // Verify laundry exists
    const laundry = await prisma.laundry.findUnique({
      where: { id: laundryId },
      select: { name: true }
    })

    if (!laundry) {
      return errorResponse('Laundry not found', 404)
    }

    // Get comprehensive data for export
    const orders = await prisma.order.findMany({
      where: {
        laundryId,
        createdAt: {
          gte: startDate,
          lte: endDate
        }
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true
          }
        },
        orderItems: {
          include: {
            product: {
              select: {
                name: true,
                category: true,
                unit: true
              }
            }
          }
        },
        address: {
          select: {
            street: true,
            city: true,
            state: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    // Calculate summary metrics
    const totalOrders = orders.length
    const totalRevenue = orders.reduce((sum, order) => sum + order.finalAmount, 0)
    const completedOrders = orders.filter(order => 
      ['COMPLETED', 'DELIVERED'].includes(order.status)
    ).length
    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0
    const uniqueCustomers = new Set(orders.map(order => order.customerId)).size

    if (format === 'excel' || format === 'csv') {
      // Prepare detailed order data for CSV/Excel
      const orderData = orders.map(order => {
        const customer = order.customer
        const itemsDescription = order.orderItems.map(item => 
          `${item.product.name} (${item.quantity} ${item.product.unit})`
        ).join('; ')
        
        const categoriesDescription = Array.from(new Set(order.orderItems.map(item => 
          item.product.category
        ))).filter(Boolean).join(', ')

        return {
          'Order ID': order.id,
          'Order Number': order.orderNumber,
          'Order Date': order.createdAt.toISOString().split('T')[0],
          'Order Time': order.createdAt.toTimeString().split(' ')[0],
          'Status': order.status,
          'Customer Name': customer.name || customer.email.split('@')[0],
          'Customer Email': customer.email,
          'Customer Phone': customer.phone || '',
          'Delivery Address': `${order.address.street}, ${order.address.city}, ${order.address.state}`,
          'Services': categoriesDescription,
          'Items Description': itemsDescription,
          'Total Items': order.orderItems.reduce((sum, item) => sum + item.quantity, 0),
          'Subtotal': order.totalAmount,
          'Delivery Fee': order.deliveryFee || 0,
          'Discount': order.discount || 0,
          'Final Amount': order.finalAmount,
          'Pickup Date': order.pickupDate ? order.pickupDate.toISOString().split('T')[0] : '',
          'Delivery Date': order.deliveryDate ? order.deliveryDate.toISOString().split('T')[0] : '',
          'Notes': order.notes || ''
        }
      })

      // Summary data
      const summaryData = [
        { 'Metric': 'Total Orders', 'Value': totalOrders },
        { 'Metric': 'Completed Orders', 'Value': completedOrders },
        { 'Metric': 'Total Revenue', 'Value': `${totalRevenue.toFixed(2)}` },
        { 'Metric': 'Average Order Value', 'Value': `${averageOrderValue.toFixed(2)}` },
        { 'Metric': 'Unique Customers', 'Value': uniqueCustomers },
        { 'Metric': 'Period', 'Value': `${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}` }
      ]

      if (format === 'csv') {
        // Generate CSV content with multiple sheets as sections
        const timestamp = new Date().toISOString().split('T')[0]
        const filename = `analytics_export_${timestamp}.csv`

        // Summary section
        const summaryCSV = [
          '# ANALYTICS SUMMARY',
          'Metric,Value',
          ...summaryData.map(row => `"${row.Metric}","${row.Value}"`)
        ].join('\n')

        // Orders section
        const orderHeaders = Object.keys(orderData[0] || {})
        const ordersCSV = [
          '',
          '# DETAILED ORDERS',
          orderHeaders.map(h => `"${h}"`).join(','),
          ...orderData.map(order => 
            orderHeaders.map(header => {
              const value = order[header as keyof typeof order]?.toString() || ''
              return `"${value.replace(/"/g, '""')}"`
            }).join(',')
          )
        ].join('\n')

        const csvContent = summaryCSV + ordersCSV

        return new Response(csvContent, {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Cache-Control': 'no-cache'
          }
        })
      } else {
        // For Excel format, we'll return JSON that can be processed by frontend
        const timestamp = new Date().toISOString().split('T')[0]
        const filename = `analytics_export_${timestamp}.json`

        const excelData = {
          metadata: {
            laundryName: laundry.name,
            exportDate: new Date().toISOString(),
            period: {
              startDate: startDate.toISOString(),
              endDate: endDate.toISOString()
            },
            format: 'excel'
          },
          summary: summaryData,
          orders: orderData,
          // Additional sheets data
          categoryBreakdown: orders.reduce((acc: { [key: string]: { category: string, orders: Set<string>, revenue: number, quantity: number } }, order) => {
            order.orderItems.forEach(item => {
              const category = item.product.category || 'Other'
              if (!acc[category]) {
                acc[category] = {
                  category,
                  orders: new Set(),
                  revenue: 0,
                  quantity: 0
                }
              }
              acc[category].orders.add(order.id)
              acc[category].revenue += item.totalPrice
              acc[category].quantity += item.quantity
            })
            return acc
          }, {}),
          customerSummary: Object.values(orders.reduce((acc: Record<string, {
            customerId: string;
            customerName: string;
            customerEmail: string;
            orders: number;
            totalSpent: number;
          }>, order) => {
            const customerId = order.customerId
            if (!acc[customerId]) {
              acc[customerId] = {
                customerId,
                customerName: order.customer.name || order.customer.email.split('@')[0],
                customerEmail: order.customer.email,
                orders: 0,
                totalSpent: 0
              }
            }
            acc[customerId].orders++
            acc[customerId].totalSpent += order.finalAmount
            return acc
          }, {}))
        }

        return new Response(JSON.stringify(excelData, null, 2), {
          headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Cache-Control': 'no-cache'
          }
        })
      }
    } else if (format === 'json') {
      // Full JSON export
      const timestamp = new Date().toISOString().split('T')[0]
      const filename = `analytics_export_${timestamp}.json`

      const jsonData = {
        exportInfo: {
          laundryId,
          laundryName: laundry.name,
          exportDate: new Date().toISOString(),
          period: {
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString()
          }
        },
        summary: {
          totalOrders,
          completedOrders,
          totalRevenue,
          averageOrderValue,
          uniqueCustomers
        },
        orders: orders.map(order => ({
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          customer: order.customer,
          items: order.orderItems.map(item => ({
            productName: item.product.name,
            category: item.product.category,
            quantity: item.quantity,
            unitPrice: item.price,
            totalPrice: item.totalPrice
          })),
          pricing: {
            totalAmount: order.totalAmount,
            deliveryFee: order.deliveryFee,
            discount: order.discount,
            finalAmount: order.finalAmount
          },
          dates: {
            orderDate: order.createdAt,
            pickupDate: order.pickupDate,
            deliveryDate: order.deliveryDate
          },
          deliveryAddress: order.address,
          notes: order.notes
        }))
      }

      return new Response(JSON.stringify(jsonData, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-cache'
        }
      })
    } else {
      return errorResponse('Invalid format. Supported formats: csv, excel, json', 400)
    }

  } catch (error) {
    console.error('Export analytics error:', error)
    return errorResponse('Failed to export analytics data', 500)
  }
}
// Deliberately independent of catalog/Auth/admin/database models. Reserved
// .example addresses and DEMO IDs cannot be used as application UUIDs.
export const demoBookings=[
 {reference:'PS-DEMO-104',name:'Ada Okoro',email:'ada@customer.example',userId:'DEMO-CUSTOMER-01',space:'Quiet desk 03',time:'10:00–13:00',totalKobo:750000,paidKobo:300000,refundedKobo:0,booking:'Confirmed',refund:'Not requested'},
 {reference:'PS-DEMO-105',name:'Tomi Bello',email:'tomi@customer.example',userId:'DEMO-CUSTOMER-02',space:'Cove · 4 seats',time:'11:00–12:00',totalKobo:800000,paidKobo:800000,refundedKobo:0,booking:'Confirmed',refund:'Not requested'},
 {reference:'PS-DEMO-106',name:'Mina Cole',email:'mina@customer.example',userId:'DEMO-CUSTOMER-03',space:'Open desk 07',time:'14:00–15:00',totalKobo:200000,paidKobo:100001,refundedKobo:0,booking:'Cancelled',refund:'Failed · assistance required'},
 {reference:'PS-DEMO-107',name:'Seyi Lane',email:'seyi@customer.example',userId:'DEMO-CUSTOMER-04',space:'Grove · 6 seats',time:'16:00–17:00',totalKobo:1200000,paidKobo:480000,refundedKobo:480000,booking:'Cancelled',refund:'Succeeded'},
]as const;
export const demoAudit=[
 {action:'Cancellation approved',time:'09:21 WAT',actor:'Nia Green',email:'nia@administrator.example',userId:'DEMO-ADMIN-01',reference:'PS-DEMO-106',detail:'Visit cancelled. Full collected payment queued for verification; approval did not settle the refund.'},
 {action:'Provider refund failed',time:'09:24 WAT',actor:'Protected recovery worker',email:null,userId:'DEMO-WORKER',reference:'PS-DEMO-106',detail:'Synthetic expired-card outcome. Collection ₦1,000.01; successful reimbursement ₦0.'},
 {action:'Replacement permanently refused',time:'09:26 WAT',actor:'Protected recovery worker',email:null,userId:'DEMO-WORKER',reference:'PS-DEMO-106',detail:'Synthetic HTTP 400 invalid_request_error. Automatic retries stopped; unresolved reimbursement remains ₦1,000.01.'},
 {action:'Cancellation refunded',time:'09:30 WAT',actor:'Protected recovery worker',email:null,userId:'DEMO-WORKER',reference:'PS-DEMO-107',detail:'Synthetic provider-confirmed success. The cancellation and refund retain separate statuses.'},
]as const;

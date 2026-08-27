#!/usr/bin/env bun

// Test dashboard auth endpoints

const BASE_URL = 'http://localhost:4142';

async function test() {
    console.log('🧪 Testing Dashboard Auth Endpoints\n');
    
    // Test 1: Check status
    console.log('1️⃣ Checking auth status...');
    try {
        const resp = await fetch(`${BASE_URL}/api/auth/status`);
        const data = await resp.json();
        console.log('   ✅ Status:', data);
    } catch (e: any) {
        console.log('   ❌ Failed:', e.message);
        return;
    }
    
    // Test 2: Set/login with password
    console.log('\n2️⃣ Setting password "test123"...');
    try {
        const resp = await fetch(`${BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: 'test123' })
        });
        const data = await resp.json();
        console.log('   ✅ Login response:', data);
        
        if (data.sessionToken) {
            // Test 3: Verify session
            console.log('\n3️⃣ Verifying session...');
            const verifyResp = await fetch(`${BASE_URL}/api/auth/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionToken: data.sessionToken })
            });
            const verifyData = await verifyResp.json();
            console.log('   ✅ Verify response:', verifyData);
        }
    } catch (e: any) {
        console.log('   ❌ Failed:', e.message);
    }
    
    // Test 4: Check status again
    console.log('\n4️⃣ Checking auth status again...');
    try {
        const resp = await fetch(`${BASE_URL}/api/auth/status`);
        const data = await resp.json();
        console.log('   ✅ Status:', data);
    } catch (e: any) {
        console.log('   ❌ Failed:', e.message);
    }
    
    console.log('\n✅ All tests complete!');
    console.log('\n💡 To reset password for testing:');
    console.log('   curl -X POST http://localhost:4142/api/auth/reset');
}

test().catch(console.error);

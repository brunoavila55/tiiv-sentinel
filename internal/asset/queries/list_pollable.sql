select id, host(mgmt_ip) as mgmt_ip, status from assets where mgmt_ip is not null;

# "><(((º> sabusabu <º)))><"
# Firma S/MIME staccata (smime.p7s) di un file, con un certificato temporaneo creato in memoria: solo per i test.
param($In, $Out)
Add-Type -AssemblyName System.Security
$rsa = [System.Security.Cryptography.RSA]::Create(2048)
$req = New-Object System.Security.Cryptography.X509Certificates.CertificateRequest("CN=Gestore PEC di Prova", $rsa, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
$cert = $req.CreateSelfSigned([DateTimeOffset]::Now.AddDays(-1), [DateTimeOffset]::Now.AddYears(30))
$bytes = [System.IO.File]::ReadAllBytes($In)
$ci = New-Object System.Security.Cryptography.Pkcs.ContentInfo(,$bytes)
$cms = New-Object System.Security.Cryptography.Pkcs.SignedCms($ci, $true)
$signer = New-Object System.Security.Cryptography.Pkcs.CmsSigner($cert)
$signer.IncludeOption = [System.Security.Cryptography.X509Certificates.X509IncludeOption]::EndCertOnly
$cms.ComputeSignature($signer, $true)
[System.IO.File]::WriteAllBytes($Out, $cms.Encode())
"ok"
